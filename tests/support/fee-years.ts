import { Client } from "pg"

import { inRolledBackTransaction } from "./db"

// Enrollment years for School fee tests. Fee schedules are never deleted and
// the local database keeps every one the tests save, so a test can't count on
// finding a year nobody has used. Instead a test claims a year: an advisory
// lock held on a connection of its own until the test releases it (or its
// process ends), so no two tests, in this run or a parallel one, hold the same
// year at once. Saving a schedule overwrites whatever an earlier run left in
// the year, so the years are reused, never used up.
//
// The range sits below `fee-schedule` tests' 2100 and up and above the seeded
// and dashboard years. Leads hold years up to 2100.
export const FEE_YEARS = { first: 2050, last: 2098 } as const

// A year no test saves a schedule in, for "no schedule" cases. It is outside
// FEE_YEARS, so claims never hand it out.
export const NO_SCHEDULE_YEAR = 2099

// The first key of every claim's advisory lock, so these locks can't meet any
// other lock taken with the same year.
const LOCK_CLASS = 106

export type FeeYearClaim = { year: number; release: () => Promise<void> }

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run npm run env:local`)
  return value
}

// Claims a free year from FEE_YEARS, trying each once in random order. Every
// year held means more claims at once than the range has years: it fails
// straight away rather than waiting. `range` is for the allocator's own tests.
export async function claimFeeYear(range: { first: number; last: number } = FEE_YEARS): Promise<FeeYearClaim> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    for (const year of shuffled(range.first, range.last)) {
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
  throw new Error(`Every fee test year from ${range.first} to ${range.last} is claimed; release claims when tests finish`)
}

// NO_SCHEDULE_YEAR, after checking that it still has no schedule. Someone
// saving one by hand would make "no schedule" tests pass for the wrong reason.
export async function noScheduleYear(): Promise<number> {
  const taken = await inRolledBackTransaction((sql) =>
    sql.query("select 1 from public.fee_schedules where enrollment_year = $1", [NO_SCHEDULE_YEAR]),
  )
  if (taken.rowCount !== 0) {
    throw new Error(`${NO_SCHEDULE_YEAR} has a Fee schedule, so it can't stand for a year without one; run npm run db:reset`)
  }
  return NO_SCHEDULE_YEAR
}

function shuffled(first: number, last: number): number[] {
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  for (let i = years.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[years[i], years[j]] = [years[j], years[i]]
  }
  return years
}
