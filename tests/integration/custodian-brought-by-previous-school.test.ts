import { randomInt, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import { recordFollowUp, scheduleFollowUp } from "@/lib/services/follow-ups"
import { declineLead } from "@/lib/services/lead-closure"
import { approveReopeningRequest, raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { createLead, updateGuardianContact, updateLeadDetails, type NewContact } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import { inRolledBackTransaction, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The custodian relationship on each lead, who brought the student and the
// previous school (#298). The region list and the previous-school check as
// the database owner, since no API role may call them; the relationship copy
// through the leads services; corrections through update_lead_details as
// Admissions Staff; the history as the Super Admin.

const MIGRATION = "supabase/migrations/20261211200100_custodian_brought_by_previous_school.sql"
const [, nextYear] = admissionYears()
const today = tanzaniaToday()

async function owner<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

function phone() {
  // A leading 06 keeps it clear of the seeded 700 000 numbers and of the
  // other test files' numbers.
  return `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function parent(overrides: Partial<NewContact> = {}): NewContact {
  return { fullName: `Custodian Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: phone(), ...overrides }
}

async function walkIn(
  guardian: { contact: NewContact } | { contactId: string },
  className: "STD 1" | "STD 2" = "STD 2",
): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian,
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)} Baba`, className, enrollmentYear: nextYear, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

type LeadRow = {
  guardian_contact_id: string
  custodian_relationship: string
  custodian_relationship_description: string | null
  brought_by_name: string | null
  brought_by_phone: string | null
  brought_by_relationship: string | null
  previous_school_name: string | null
  previous_school_type: string | null
  previous_school_region: string | null
  previous_school_not_known: boolean
}

async function row(leadId: string): Promise<LeadRow> {
  const [found] = await owner<LeadRow>(
    `select guardian_contact_id, custodian_relationship::text, custodian_relationship_description,
            brought_by_name, brought_by_phone, brought_by_relationship,
            previous_school_name, previous_school_type::text, previous_school_region, previous_school_not_known
     from public.leads where id = $1`,
    [leadId],
  )
  return found
}

// The fee, discount, status and Seat priority of these leads, from the same
// snapshot the migration checks.
async function fees(leadIds: string[]) {
  return owner<{ item: string; value: unknown }>(
    "select item, value from public.fee_snapshot() where item = any($1::text[]) order by item",
    [leadIds.map((id) => `lead:${id}`)],
  )
}

async function correct(client: SupabaseClient, leadId: string, changes: Record<string, unknown>) {
  const { data, error } = await client.rpc("update_lead_details", { lead_id: leadId, changes })
  if (error) return { error: error.message, field: error.details ? (JSON.parse(error.details) as { field?: string }).field : undefined }
  return { data }
}

describe("the previous-school region list", () => {
  test("holds Tanzania's 31 regions and Outside Tanzania, once each", async () => {
    const [{ regions }] = await owner<{ regions: string[] }>("select public.previous_school_regions() as regions")
    expect(regions).toHaveLength(32)
    expect(new Set(regions).size).toBe(32)
    expect(regions).toEqual(
      expect.arrayContaining(["Dar es Salaam", "Pwani", "Songwe", "Mjini Magharibi", "Kusini Pemba", "Outside Tanzania"]),
    )
  })

  test.each([
    ["Pwani", "Pwani"],
    ["  dar es salaam ", "Dar es Salaam"],
    ["outside tanzania", "Outside Tanzania"],
    ["Nairobi", null],
    ["Zanzibar", null],
    ["", null],
    [null, null],
  ])("reads %j as %j", async (given, expected) => {
    const [{ region }] = await owner<{ region: string | null }>("select public.previous_school_region($1) as region", [given])
    expect(region).toBe(expected)
  })
})

describe("the previous-school check", () => {
  const notAsked = ["DAY CARE", "KG 1", "KG 2", "STD 1"]
  const asked = ["STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3", "FORM 4"]

  test("asks from STD 2 to FORM 4, and nothing below STD 2", async () => {
    const rows = await owner<{ class_name: string; asked: boolean }>(
      "select c::text as class_name, public.previous_school_asked(c) as asked from unnest(enum_range(null::public.lead_class)) c",
    )
    expect(rows.filter((r) => r.asked).map((r) => r.class_name)).toEqual(asked)
    expect(rows.filter((r) => !r.asked).map((r) => r.class_name)).toEqual(notAsked)
  })

  test.each([
    ["STD 2", null, false, true],
    ["FORM 4", "  ", false, true],
    ["STD 2", null, true, false],
    ["STD 3", "Mfano Primary School", false, false],
    ["DAY CARE", null, false, false],
    ["KG 2", null, false, false],
    ["STD 1", null, null, false],
  ])("%s with name %j and Not known yet %j is missing: %j", async (className, name, notKnown, missing) => {
    const [{ m }] = await owner<{ m: boolean }>(
      "select public.previous_school_answer_missing($1::public.lead_class, $2, $3) as m",
      [className, name, notKnown],
    )
    expect(m).toBe(missing)
  })

  test("is granted to no API role", async () => {
    const rows = await owner<{ name: string; callers: string[] }>(
      `select p.proname as name,
              array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                    where has_function_privilege(r, p.oid, 'execute')) as callers
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('previous_school_regions', 'previous_school_region', 'previous_school_asked',
                           'previous_school_answer_missing', 'set_lead_custodian_relationship',
                           'sync_lead_custodian_relationship')`,
    )
    expect(rows).toHaveLength(6)
    for (const r of rows) expect(r.callers, r.name).toEqual([])
  })
})

describe("the custodian relationship on each lead", () => {
  test("every lead holds its contact's relationship", async () => {
    const [{ differing }] = await owner<{ differing: number }>(
      `select count(*)::int as differing
       from public.leads l join public.guardian_contacts g on g.id = l.guardian_contact_id
       where l.custodian_relationship is distinct from g.relationship
          or l.custodian_relationship_description is distinct from g.relationship_description`,
    )
    expect(differing).toBe(0)
  })

  test("a new lead and its sibling take the contact's relationship", async () => {
    const first = await walkIn({ contact: parent({ relationship: "Other", relationshipDescription: "Aunt" }) })
    const { guardian_contact_id: contactId } = await row(first)
    const second = await walkIn({ contactId })

    for (const id of [first, second]) {
      expect(await row(id)).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Aunt" })
    }
  })

  test("a contact's corrected relationship reaches every lead on it, a Declined one too, with history and no fee moved", async () => {
    const open = await walkIn({ contact: parent() })
    const { guardian_contact_id: contactId } = await row(open)
    const declined = await walkIn({ contactId })
    expect(await declineLead(await signedIn(MANAGER), declined, { reason: "Fees or cost" })).toEqual({ ok: true, data: null })
    const before = await fees([open, declined])

    expect(
      await updateGuardianContact(await signedIn(ADMISSIONS), contactId, {
        relationship: "Other",
        relationshipDescription: "Grandmother",
      }),
    ).toEqual({ ok: true, data: null })

    for (const id of [open, declined]) {
      expect(await row(id)).toMatchObject({
        custodian_relationship: "Other",
        custodian_relationship_description: "Grandmother",
      })
    }
    expect(await fees([open, declined])).toEqual(before)

    // The lead's own entry, by the staff member who corrected the contact.
    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), declined)
    if (!history.ok) throw new Error(`history refused: ${history.error}`)
    const copy = history.data.entries.find(
      (e) => e.record === "lead" && e.changes.some((c) => c.field === "custodian_relationship"),
    )
    expect(copy?.actor).toBe(ADMISSIONS.name)
    expect(copy?.changes).toEqual(
      expect.arrayContaining([
        { field: "custodian_relationship", from: "Mother", to: "Other" },
        { field: "custodian_relationship_description", from: null, to: "Grandmother" },
      ]),
    )

    // The Declined lead itself stays closed to any other change.
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("select set_config('app.lead_lifecycle_override', 'custodian_sync', true)")
        await sql.query("update public.leads set student_name = student_name || ' X' where id = $1", [declined])
      }),
    ).rejects.toThrow(/lead_closed/)
  })

  test("a lead moved to another contact takes that contact's relationship, unless the move sets its own", async () => {
    const lead = await walkIn({ contact: parent() })
    const { guardian_contact_id: ownContact } = await row(lead)
    const other = await walkIn({ contact: parent({ relationship: "Guardian" }) })
    const { guardian_contact_id: otherContact } = await row(other)

    const [moved, ownSet] = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const a = await sql.query(
        "update public.leads set guardian_contact_id = $2 where id = $1 returning custodian_relationship::text as r",
        [lead, otherContact],
      )
      const b = await sql.query(
        `update public.leads set guardian_contact_id = $2, custodian_relationship = 'Father'
         where id = $1 returning custodian_relationship::text as r`,
        [lead, ownContact],
      )
      return [a.rows[0].r, b.rows[0].r]
    })
    expect(moved).toBe("Guardian")
    expect(ownSet).toBe("Father")
  })
})

describe("correcting who brought the student", () => {
  test("stores the name, a normalized phone and the relationship, and shows them in the history", async () => {
    const lead = await walkIn({ contact: parent() })
    const staff = await signedIn(ADMISSIONS)

    expect(
      await correct(staff, lead, {
        brought_by_name: "  Neema Petro ",
        brought_by_phone: "+255 655 123 456",
        brought_by_relationship: " aunt ",
      }),
    ).toEqual({ data: { result: "updated" } })
    expect(await row(lead)).toMatchObject({
      brought_by_name: "Neema Petro",
      brought_by_phone: "+255655123456",
      brought_by_relationship: "aunt",
    })

    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), lead)
    if (!history.ok) throw new Error(`history refused: ${history.error}`)
    const [latest] = history.data.entries
    expect(latest.actor).toBe(ADMISSIONS.name)
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "brought_by_name", from: null, to: "Neema Petro" },
        { field: "brought_by_phone", from: null, to: "+255655123456" },
        { field: "brought_by_relationship", from: null, to: "aunt" },
      ]),
    )
  })

  test("refuses a bad phone, and a phone or relationship with no name", async () => {
    const lead = await walkIn({ contact: parent() })
    const staff = await signedIn(ADMISSIONS)

    expect(await correct(staff, lead, { brought_by_name: "Asha", brought_by_phone: "12" })).toEqual({
      error: "invalid",
      field: "brought_by_phone",
    })
    expect(await correct(staff, lead, { brought_by_phone: "0655123456" })).toEqual({
      error: "invalid",
      field: "brought_by_name",
    })
    expect(await correct(staff, lead, { brought_by_relationship: "uncle" })).toEqual({
      error: "invalid",
      field: "brought_by_name",
    })
    expect(await correct(staff, lead, { brought_by_name: "x".repeat(121) })).toEqual({
      error: "invalid",
      field: "brought_by_name",
    })

    // The table refuses a malformed phone from any writer, not only this function.
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.leads set brought_by_name = 'Asha Ali', brought_by_phone = '12' where id = $1", [lead])
      }),
    ).rejects.toThrow(/leads_brought_by_phone_normalized/)

    // Clearing all three together is a correction like any other.
    await correct(staff, lead, { brought_by_name: "Asha Ali", brought_by_relationship: "neighbour" })
    expect(await correct(staff, lead, { brought_by_name: "", brought_by_relationship: null })).toEqual({
      data: { result: "updated" },
    })
    expect(await row(lead)).toMatchObject({ brought_by_name: null, brought_by_phone: null, brought_by_relationship: null })
  })
})

describe("correcting the previous school", () => {
  test("stores the details with the list's spelling of the region, and moves no fee", async () => {
    const lead = await walkIn({ contact: parent() })
    const staff = await signedIn(ADMISSIONS)
    const before = await fees([lead])

    expect(
      await correct(staff, lead, {
        previous_school_name: " Mfano English Medium School ",
        previous_school_type: "private",
        previous_school_region: "pwani",
      }),
    ).toEqual({ data: { result: "updated" } })
    expect(await row(lead)).toMatchObject({
      previous_school_name: "Mfano English Medium School",
      previous_school_type: "private",
      previous_school_region: "Pwani",
      previous_school_not_known: false,
    })
    expect(await fees([lead])).toEqual(before)

    expect(await correct(staff, lead, { previous_school_region: "Outside Tanzania" })).toEqual({
      data: { result: "updated" },
    })
    expect((await row(lead)).previous_school_region).toBe("Outside Tanzania")
  })

  test("refuses a region off the list, a type off the list and incomplete details", async () => {
    const lead = await walkIn({ contact: parent() })
    const staff = await signedIn(ADMISSIONS)
    const school = { previous_school_name: "Example Primary School", previous_school_type: "public" }

    expect(await correct(staff, lead, { ...school, previous_school_region: "Nairobi" })).toEqual({
      error: "invalid",
      field: "previous_school_region",
    })
    expect(
      await correct(staff, lead, { ...school, previous_school_type: "international", previous_school_region: "Tanga" }),
    ).toEqual({ error: "invalid", field: "previous_school_type" })
    expect(await correct(staff, lead, { previous_school_name: "Example Primary School" })).toEqual({
      error: "invalid",
      field: "previous_school_type",
    })
    expect(await correct(staff, lead, school)).toEqual({ error: "invalid", field: "previous_school_region" })
    expect(await correct(staff, lead, { ...school, previous_school_name: "E", previous_school_region: "Tanga" })).toEqual({
      error: "invalid",
      field: "previous_school_name",
    })
    expect((await row(lead)).previous_school_name).toBeNull()
  })

  test("takes Not known yet, refuses it beside details, and takes the details later", async () => {
    const lead = await walkIn({ contact: parent() })
    const staff = await signedIn(ADMISSIONS)

    expect(await correct(staff, lead, { previous_school_not_known: true })).toEqual({ data: { result: "updated" } })
    expect((await row(lead)).previous_school_not_known).toBe(true)

    const details = {
      previous_school_name: "Example Primary School",
      previous_school_type: "public",
      previous_school_region: "Dar es Salaam",
    }
    expect(await correct(staff, lead, details)).toEqual({ error: "invalid", field: "previous_school_not_known" })
    expect(await correct(staff, lead, { previous_school_not_known: "yes" })).toEqual({
      error: "invalid",
      field: "previous_school_not_known",
    })

    expect(await correct(staff, lead, { ...details, previous_school_not_known: false })).toEqual({
      data: { result: "updated" },
    })
    expect(await row(lead)).toMatchObject({ ...details, previous_school_not_known: false })

    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), lead)
    if (!history.ok) throw new Error(`history refused: ${history.error}`)
    const [latest] = history.data.entries
    expect(latest.actor).toBe(ADMISSIONS.name)
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "previous_school_not_known", from: true, to: false },
        { field: "previous_school_region", from: null, to: "Dar es Salaam" },
      ]),
    )
  })

  test("a class change to STD 2 never needs it on the same save", async () => {
    const lead = await walkIn({ contact: parent() }, "STD 1")
    expect(await updateLeadDetails(await signedIn(ADMISSIONS), lead, { className: "STD 2" })).toEqual({
      ok: true,
      data: null,
    })
    expect(await row(lead)).toMatchObject({ previous_school_name: null, previous_school_not_known: false })
  })
})

// Contact corrections take the Family lock, then the contact's leads, then
// the contact. Declining and approving a reopening, which recompute under the
// Family lock, now take it before their row locks, so neither can hold a lead
// a contact correction waits for while it waits for the Family lock.
describe("the lock order", () => {
  async function familyLockWaiters(sql: Client, contactId: string): Promise<number> {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_locks
       where locktype = 'advisory' and not granted and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
      [contactId],
    )
    return rows[0].n
  }

  // Holds the lead's Family lock while `work` starts, checks that `work` waits
  // for it holding no lock on the lead's row, then lets it finish.
  async function waitsForFamilyFirst<T>(leadId: string, work: () => Promise<T>, requestId?: string): Promise<T> {
    const { guardian_contact_id: contactId } = await row(leadId)
    return inRolledBackTransaction(async (holder) => {
      await holder.query("select public.lock_families(array[$1::uuid])", [contactId])
      const running = work()
      for (let tries = 0; (await familyLockWaiters(holder, contactId)) === 0; tries++) {
        if (tries > 100) throw new Error("it never waited on the Family lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const rowFree = await inRolledBackTransaction(async (other) => {
        await other.query("select public.set_audit_actor('system')")
        const locked = await other.query("select id from public.leads where id = $1 for update skip locked", [leadId])
        if (requestId === undefined) return locked.rowCount === 1
        const request = await other.query("select id from public.reopening_requests where id = $1 for update skip locked", [
          requestId,
        ])
        return locked.rowCount === 1 && request.rowCount === 1
      })
      expect(rowFree).toBe(true)
      await holder.query("rollback")
      await holder.query("begin")
      return running
    })
  }

  test("a decline takes the Family lock before the lead's row", async () => {
    const lead = await walkIn({ contact: parent() })
    const manager = await signedIn(MANAGER)
    expect(await waitsForFamilyFirst(lead, () => declineLead(manager, lead, { reason: "Fees or cost" }))).toEqual({
      ok: true,
      data: null,
    })
  })

  test("approving a reopening takes the Family lock before the request and the lead's row", async () => {
    const lead = await walkIn({ contact: parent() })
    const manager = await signedIn(MANAGER)
    expect(await declineLead(manager, lead, { reason: "Fees or cost" })).toEqual({ ok: true, data: null })
    const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family is back.", source: "lead" })
    if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
    expect(await waitsForFamilyFirst(lead, () => approveReopeningRequest(manager, raised.data), raised.data)).toEqual({
      ok: true,
      data: null,
    })
  })

  test("a decline recorded as a follow-up outcome takes the Family lock before the lead's row", async () => {
    const lead = await walkIn({ contact: parent() })
    const scheduledFollowUp = await scheduleFollowUp(await signedIn(ADMISSIONS), lead, {
      dueOn: new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    })
    if (!scheduledFollowUp.ok) throw new Error(`schedule failed: ${JSON.stringify(scheduledFollowUp.error)}`)
    const manager = await signedIn(MANAGER)
    const recorded = await waitsForFamilyFirst(lead, () =>
      recordFollowUp(manager, lead, {
        followUpId: scheduledFollowUp.data.followUpId,
        comment: "The family chose a school nearer home.",
        method: "Phone call",
        contactedBy: ADMISSIONS.id,
        contactedAt: new Date(Date.now() - 60_000).toISOString(),
        outcome: { kind: "lead_declined", reason: "Enrolled elsewhere" },
      }),
    )
    expect(recorded.ok).toBe(true)
  })

  test("a contact correction takes the Family lock before the contact's leads", async () => {
    const lead = await walkIn({ contact: parent() })
    const { guardian_contact_id: contactId } = await row(lead)
    const staff = await signedIn(ADMISSIONS)
    expect(await waitsForFamilyFirst(lead, () => updateGuardianContact(staff, contactId, { relationship: "Father" }))).toEqual({
      ok: true,
      data: null,
    })
    expect((await row(lead)).custodian_relationship).toBe("Father")
  })
})

// The backfill block, run again against a moved fee: the check raises and
// undoes everything the block did.
describe("the migration's backfill", () => {
  test("raises when a fee moved between the snapshots", async () => {
    const source = readFileSync(MIGRATION, "utf8")
    const block = source.match(/do \$\$\nbegin\n {4}perform public\.set_audit_actor\('system'\);[\s\S]*?\n\$\$;/)?.[0]
    if (!block) throw new Error("backfill block not found")
    const tampered = block.replace(
      "select * from public.fee_snapshot();",
      () => "select * from public.fee_snapshot();\n    update custodian_fee_snapshot set value = value || '{\"school_fee\": -1}' where item like 'lead:%';",
    )
    expect(tampered).not.toBe(block)

    await inRolledBackTransaction(async (sql) => {
      await sql.query("savepoint s")
      await expect(sql.query(tampered)).rejects.toThrow(/fee_snapshot_changed/)
      await sql.query("rollback to savepoint s")
      // Untouched, the block passes: every lead already holds its relationship.
      await sql.query(block)
    })
  })

  test("fills every lead on file, closed and Enrolled ones included, and moves no fee", async () => {
    const source = readFileSync(MIGRATION, "utf8")
    const block = source.match(/do \$\$\nbegin\n {4}perform public\.set_audit_actor\('system'\);[\s\S]*?\n\$\$;/)?.[0]
    if (!block) throw new Error("backfill block not found")

    const { emptied, statuses, differing } = await inRolledBackTransaction(async (sql) => {
      // Every lead as it was before the migration: no relationship of its own.
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("alter table public.leads alter column custodian_relationship drop not null")
      await sql.query("select set_config('app.lead_lifecycle_override', 'custodian_sync', true)")
      const cleared = await sql.query(
        "update public.leads set custodian_relationship = null, custodian_relationship_description = null",
      )
      await sql.query("select set_config('app.lead_lifecycle_override', '', true)")

      await sql.query(block)

      const kinds = await sql.query<{ kind: string }>(
        `select distinct case when closure is not null then 'closed' else status::text end as kind from public.leads`,
      )
      const after = await sql.query<{ n: number }>(
        `select count(*)::int as n
         from public.leads l join public.guardian_contacts g on g.id = l.guardian_contact_id
         where l.custodian_relationship is distinct from g.relationship
            or l.custodian_relationship_description is distinct from g.relationship_description`,
      )
      return { emptied: cleared.rowCount ?? 0, statuses: kinds.rows.map((r) => r.kind), differing: after.rows[0].n }
    })

    expect(emptied).toBeGreaterThan(0)
    // The seeds hold leads in every state the backfill must reach.
    expect(statuses).toEqual(expect.arrayContaining(["Enrolled", "Declined", "closed"]))
    expect(differing).toBe(0)
  })
})
