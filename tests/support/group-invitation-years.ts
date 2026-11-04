import { Client } from "pg"

// Enrollment years for the group-invitation tests (#186), integration and
// browser alike. Their leads must sit in years no other suite counts leads in
// (the dashboard's 2031, the interview list's 2032 to 2039, the fee years), so
// these years are theirs alone: the top of the old fee range.
//
// Links and invitations are never deleted, so a year can't start empty again.
// Instead a test claims a year: an advisory lock held on a connection of its
// own until the test releases it, so no two tests use the same year at once.
// Claiming first moves every earlier group-invitation test lead (a student
// named "Invitee …") out to RETIRED_YEAR. The year's invitations then cover
// nobody in it, so its count and earlier-link filter see only the new test's
// leads, and the years are reused, never used up. A test that saves a link
// replaces whatever link an earlier one left (see `currentGroupLink`).
//
// Tests that need a year with no link at all claim from NO_LINK_YEARS, where
// no test saves one.
export const GROUP_INVITATION_YEARS = { first: 2086, last: 2098 } as const
export const NO_LINK_YEARS = { first: 2084, last: 2085 } as const

// Where claimed years' earlier leads go. No suite counts leads in it.
export const RETIRED_YEAR = 2030

// Apart from the fee years' 106 and the interview years' 107.
const LOCK_CLASS = 108

export type GroupInvitationYearClaim = { year: number; release: () => Promise<void> }

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run npm run env:local`)
  return value
}

export async function claimGroupInvitationYear(options: { link: boolean } = { link: true }): Promise<GroupInvitationYearClaim> {
  const { first, last } = options.link ? GROUP_INVITATION_YEARS : NO_LINK_YEARS
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    for (const year of shuffled(first, last)) {
      const { rows } = await sql.query<{ claimed: boolean }>("select pg_try_advisory_lock($1, $2) as claimed", [
        LOCK_CLASS,
        year,
      ])
      if (!rows[0].claimed) continue
      if (!options.link) {
        const linked = await sql.query("select 1 from public.whatsapp_group_links where enrollment_year = $1", [year])
        if (linked.rowCount) {
          throw new Error(`${year} has a group link, so it can't stand for a year without one; run npm run db:reset`)
        }
      }
      await retireEarlierLeads(sql, year)
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
  } catch (error) {
    await sql.end()
    throw error
  }
  await sql.end()
  throw new Error(`Every group-invitation test year from ${first} to ${last} is claimed; release claims when tests finish`)
}

// The year's link as it stands, or null: what a test passes as the link it
// last saw when it saves one of its own.
export async function currentGroupLink(year: number): Promise<string | null> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    const { rows } = await sql.query<{ url: string }>("select url from public.whatsapp_group_links where enrollment_year = $1", [
      year,
    ])
    return rows[0]?.url ?? null
  } finally {
    await sql.end()
  }
}

async function retireEarlierLeads(sql: Client, year: number) {
  await sql.query("begin")
  try {
    await sql.query("select public.set_audit_actor('system')")
    // Closed leads move too, as the database owner moving them out of the way.
    await sql.query("select public.set_lead_lifecycle_override('reopen')")
    await sql.query("update public.leads set enrollment_year = $2 where enrollment_year = $1 and student_name like 'Invitee %'", [
      year,
      RETIRED_YEAR,
    ])
    await sql.query("commit")
  } catch (error) {
    await sql.query("rollback").catch(() => {})
    throw error
  }
}

function shuffled(first: number, last: number): number[] {
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  for (let i = years.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[years[i], years[j]] = [years[j], years[i]]
  }
  return years
}
