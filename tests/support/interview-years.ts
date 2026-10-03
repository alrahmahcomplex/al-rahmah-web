import { Client } from "pg"

// Enrollment years for the Interviews screen tests. Interviews are never
// deleted and the local database keeps every one the tests register, so a
// year never starts empty again. Instead a test claims a year: an advisory
// lock held on a connection of its own until the test releases it (or its
// process ends), so no other test lists or registers in it at the same time.
// Tests compare against rows they made themselves, so the years are reused,
// never used up.
//
// The range sits between the dashboard tests' 2031 and the interview
// registration tests' 2040 and up, and away from the seeded years.
export const INTERVIEW_LIST_YEARS = { first: 2032, last: 2039 } as const

// The first key of every claim's advisory lock, apart from the fee years'
// 106, so these locks can't meet any other lock taken with the same year.
const LOCK_CLASS = 107

export type InterviewYearClaim = { year: number; release: () => Promise<void> }

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run npm run env:local`)
  return value
}

// Claims a free year, trying each once in random order. Every year held means
// more claims at once than the range has years: it fails straight away rather
// than waiting.
export async function claimInterviewYear(): Promise<InterviewYearClaim> {
  const { first, last } = INTERVIEW_LIST_YEARS
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i).sort(() => Math.random() - 0.5)
    for (const year of years) {
      const { rows } = await sql.query<{ claimed: boolean }>("select pg_try_advisory_lock($1, $2) as claimed", [
        LOCK_CLASS,
        year,
      ])
      if (rows[0].claimed) {
        let released = false
        return {
          year,
          release: async () => {
            if (released) return
            released = true
            await sql.end()
          },
        }
      }
    }
  } catch (error) {
    await sql.end()
    throw error
  }
  await sql.end()
  throw new Error(`Every interview list test year from ${first} to ${last} is claimed; release claims when tests finish`)
}
