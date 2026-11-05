import { Client } from "pg"

// Enrollment years for tests that check which S/N a registration gets. S/N
// counters are never deleted, and other tests register interviews in their
// own years at the same time, so a test can't just pick a year that looks
// unused: two files once picked the same one and got each other's numbers.
// Instead a test claims a year: an advisory lock held on a connection of its
// own until the test releases it (or its process ends). No other test
// registers in these years, so while the claim is held the year's next S/N is
// the one read here.
//
// The range sits between the Interviews screen tests' 2032 to 2039 and the
// fee years' 2050 and up. No other suite puts leads in it.
export const INTERVIEW_SERIAL_YEARS = { first: 2040, last: 2049 } as const

// Apart from the fee years' 106, the interview list years' 107 and the
// group-invitation years' 108.
const LOCK_CLASS = 109

export type InterviewSerialYearClaim = {
  year: number
  // The S/N the year's next registration gets: 1 in a year no S/N has been
  // issued in.
  nextSerial: number
  release: () => Promise<void>
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run npm run env:local`)
  return value
}

// Claims a year, trying each once. `fresh` asks for a year no S/N has been
// issued in, so its S/Ns count from 1; those run out as runs add counters,
// and `npm run db:reset` brings them back. Otherwise a year with a counter
// is preferred, to leave the fresh ones for tests that need them.
export async function claimInterviewSerialYear(
  { fresh }: { fresh: boolean } = { fresh: false },
): Promise<InterviewSerialYearClaim> {
  const { first, last } = INTERVIEW_SERIAL_YEARS
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    const { rows: counters } = await sql.query<{ enrollment_year: number }>(
      "select enrollment_year from public.interview_serial_counters where enrollment_year between $1 and $2",
      [first, last],
    )
    const used = new Set(counters.map((row) => row.enrollment_year))
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i)
      .filter((year) => !fresh || !used.has(year))
      .sort(() => Math.random() - 0.5)
    if (!fresh) years.sort((a, b) => Number(used.has(b)) - Number(used.has(a)))
    for (const year of years) {
      const { rows } = await sql.query<{ claimed: boolean }>("select pg_try_advisory_lock($1, $2) as claimed", [
        LOCK_CLASS,
        year,
      ])
      if (!rows[0].claimed) continue
      // Read again under the claim: a test that held the year a moment ago
      // may have registered in it since the list above was read.
      const { rows: counter } = await sql.query<{ last_number: number }>(
        "select last_number from public.interview_serial_counters where enrollment_year = $1",
        [year],
      )
      if (fresh && counter.length > 0) {
        await sql.query("select pg_advisory_unlock($1, $2)", [LOCK_CLASS, year])
        continue
      }
      let released = false
      return {
        year,
        nextSerial: (counter[0]?.last_number ?? 0) + 1,
        release: async () => {
          if (released) return
          released = true
          await sql.end()
        },
      }
    }
  } catch (error) {
    await sql.end()
    throw error
  }
  await sql.end()
  throw new Error(
    fresh
      ? `No enrollment year from ${first} to ${last} is both unclaimed and without S/Ns; run npm run db:reset`
      : `Every S/N test year from ${first} to ${last} is claimed; release claims when tests finish`,
  )
}
