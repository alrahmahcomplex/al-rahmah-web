import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { describeLeadHistory } from "@/app/staff/applicants/[id]/history/describe"
import { admissionYears } from "@/lib/admission-form"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { createLead, getLead } from "@/lib/services/leads"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { ADMISSIONS, SUPER_ADMIN } from "../support/fixtures"

// What 20270118100100 leaves behind (#312): the guardian contact holds no
// relationship, the guard and the fallback are gone, and no function in the
// schema still names the dropped columns, as the database owner in
// transactions that are rolled back. And how the audit row the migration
// wrote for a contact with no audit trail reads on a child's History, as the
// Super Admin.

type FunctionError = { name: string; message: string }

// Every error the database finds in the public schema's functions.
//
// PL/pgSQL bodies are only parsed when they are created, so a column that no
// longer exists stays hidden until the line runs. plpgsql_check reads every
// statement against the tables as they are now. A SQL-language body is
// checked in full when it is created, so creating each one again from its own
// definition checks it again. Both happen inside the caller's transaction,
// which is rolled back: the extension never stays installed.
async function functionErrors(sql: Client): Promise<FunctionError[]> {
  try {
    await sql.query("create extension if not exists plpgsql_check")
  } catch (error) {
    throw new Error(
      `This test needs the plpgsql_check extension, which local Supabase's Postgres image ships. It could not be created: ${(error as Error).message}`,
    )
  }

  // A trigger function is checked against each table it is a trigger on.
  const plpgsql = await sql.query<FunctionError>(
    `select p.oid::regprocedure::text as name, format('line %s: %s', c.lineno, c.message) as message
     from pg_catalog.pg_proc p
     join pg_catalog.pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
     left join lateral (
       select distinct t.tgrelid from pg_catalog.pg_trigger t where t.tgfoid = p.oid
     ) used on p.prorettype = 'trigger'::regtype
     cross join lateral plpgsql_check_function_tb(p.oid, coalesce(used.tgrelid, 0)) c
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype <> 'event_trigger'::regtype
       and (p.prorettype <> 'trigger'::regtype or used.tgrelid is not null)
       and c.level = 'error'
     order by 1, 2`,
  )

  const errors = [...plpgsql.rows]
  await sql.query("set local check_function_bodies = on")
  const written = await sql.query<{ name: string; definition: string }>(
    `select p.oid::regprocedure::text as name, pg_get_functiondef(p.oid) as definition
     from pg_catalog.pg_proc p
     join pg_catalog.pg_language l on l.oid = p.prolang and l.lanname = 'sql'
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     order by 1`,
  )
  for (const { name, definition } of written.rows) {
    await sql.query("savepoint function_check")
    try {
      await sql.query(definition)
      await sql.query("release savepoint function_check")
    } catch (error) {
      await sql.query("rollback to savepoint function_check")
      errors.push({ name, message: (error as Error).message })
    }
  }
  return errors
}

const namesRelationship = (error: FunctionError) => /relationship/i.test(error.message)

describe("the guardian contact's relationship, dropped", () => {
  test("the contact holds no relationship column, and neither trigger is left", async () => {
    await inRolledBackTransaction(async (sql) => {
      const columns = await sql.query<{ name: string }>(
        `select a.attname as name from pg_catalog.pg_attribute a
         where a.attrelid = 'public.guardian_contacts'::regclass and a.attnum > 0 and not a.attisdropped
         order by a.attnum`,
      )
      expect(columns.rows.map((c) => c.name)).toEqual([
        "id",
        "full_name",
        "phone",
        "whatsapp",
        "origin",
        "pending_family_match_id",
        "created_at",
      ])

      const left = await sql.query<{ name: string }>(
        `select p.proname as name from pg_catalog.pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('refuse_contact_relationship_change', 'set_lead_custodian_relationship',
                             'sync_lead_custodian_relationship')
         union all
         select t.tgname from pg_catalog.pg_trigger t
         where t.tgrelid in ('public.guardian_contacts'::regclass, 'public.leads'::regclass)
           and t.tgname in ('refuse_contact_relationship_change', 'set_lead_custodian_relationship',
                            'sync_lead_custodian_relationship')`,
      )
      expect(left.rows).toEqual([])
    })
  })

  test("a lead inserted with no relationship is refused: nothing fills it in", async () => {
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(
          `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, guardian_contact_id)
           select free.number, 'No Relationship Pupil', 'STD 1', l.enrollment_year, 'Day', 'Applied', l.guardian_contact_id
           from (select guardian_contact_id, enrollment_year from public.leads order by created_at, id limit 1) l,
                (select 'ADMSN-' || lpad(n::text, 5, '0') as number from generate_series(0, 99999) n
                 where not exists (select 1 from public.leads x where x.admission_number = 'ADMSN-' || lpad(n::text, 5, '0'))
                 order by random() limit 1) free`,
        )
      }),
    ).rejects.toThrow(/null value in column "custodian_relationship"/)
  })

  // Reads every function in the schema, so it gets more time than one query.
  test("no function names the dropped columns", { timeout: 180_000 }, async () => {
    const errors = await inRolledBackTransaction(functionErrors)
    expect(errors.filter(namesRelationship)).toEqual([])
  })

  test("the check finds a PL/pgSQL and a SQL function that name them", { timeout: 180_000 }, async () => {
    const errors = await inRolledBackTransaction(async (sql) => {
      // Bodies are not checked while these two are made, as a function
      // written before the drop was not checked after it.
      await sql.query("set local check_function_bodies = off")
      await sql.query(
        `create function public.probe_contact_relationship_plpgsql() returns text language plpgsql set search_path = '' as $fn$
         declare found text;
         begin
           select g.relationship::text into found from public.guardian_contacts g limit 1;
           return found;
         end;
         $fn$`,
      )
      await sql.query(
        `create function public.probe_contact_relationship_sql() returns text language sql set search_path = '' as $fn$
           select g.relationship_description from public.guardian_contacts g limit 1;
         $fn$`,
      )
      return functionErrors(sql)
    })

    const found = errors.filter(namesRelationship)
    expect(found.map((e) => e.name)).toEqual(["probe_contact_relationship_plpgsql()", "probe_contact_relationship_sql()"])
    expect(found[0].message).toMatch(/column g\.relationship does not exist/)
    expect(found[1].message).toMatch(/column g\.relationship_description does not exist/)
  })

  // The migration wrote this row for a contact whose relationship no audit
  // row held, so the value outlived the column. Hosted keeps such rows for
  // good, so the History screen must go on reading them this way.
  test("the row written for a contact with no audit trail reads on History as a change to None", async () => {
    const staff = await signedIn(ADMISSIONS)
    const [, nextYear] = admissionYears()
    const name = `Trail Parent ${randomUUID().slice(0, 6)}`
    const created = await createLead(staff, {
      guardian: {
        contact: { fullName: name, relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
      },
      student: { fullName: `Pupil ${randomUUID().slice(0, 8)} Baba`, className: "STD 2", enrollmentYear: nextYear, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: tanzaniaToday() },
    })
    if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`)
    const lead = await getLead(staff, created.data.leadId)
    if (!lead.ok) throw new Error("setup failed: lead missing")

    // The same values the migration's write step gives the row.
    await asSystem((sql) =>
      sql.query(
        `insert into public.audit_log (table_name, row_id, lead_id, action, old_values, new_values, scope, actor_kind, actor_staff_id)
         select 'guardian_contacts', $1, null, 'update', '{"relationship": "Mother"}', '{"relationship": null}', s.scope, 'system', null
         from public.audit_scopes s where s.table_name = 'public.guardian_contacts'::regclass`,
        [lead.data.contact.id],
      ),
    )

    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), lead.data.id)
    if (!history.ok) throw new Error(`history refused: ${history.error}`)
    expect(history.data.entries[0]).toMatchObject({
      record: "contact",
      recordId: lead.data.contact.id,
      action: "update",
      actor: "System",
      changes: [{ field: "relationship", from: "Mother", to: null }],
    })

    const [latest] = describeLeadHistory(history.data.entries, history.data.contactNames)
    expect(latest).toMatchObject({
      actor: "System",
      summary: `changed the parent or guardian ${name}`,
      changes: [{ label: "Relationship", from: "Mother", to: "None" }],
    })
  })
})
