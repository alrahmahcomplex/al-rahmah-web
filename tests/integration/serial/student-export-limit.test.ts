import { describe, expect, test } from "vitest"

import { inRolledBackTransaction } from "../../support/db"
import { actAs, freshCode } from "../../support/discount-codes"
import { ADMISSIONS, MANAGER } from "../../support/fixtures"

// The student export's 5000-student limit (owner decisions of 2026-11-09).
// The rest of the export's tests are in ../student-export.test.ts.
//
// This test inserts 5001 leads in one transaction and holds them for many
// seconds before it rolls back. Those rows take 5001 of the 100,000 Admission
// Numbers. A lead created elsewhere meanwhile that draws one of them waits on
// the unique constraint until the rollback, and the authenticated role's
// statement timeout cancels it first (57014, which createLead reports as
// unavailable; #438). So it runs in integration-serial (vitest.config.mts):
// after every other file, and alone.

describe("which students", () => {
  test("refuses more than 5000 students", async () => {
    const answer = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const batch = await sql.query<{ id: string }>(
        `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
         values ('students', 'big.csv', $1, 1, 1, 0, 0) returning id`,
        [MANAGER.id],
      )
      const contact = await sql.query<{ id: string }>(
        "insert into public.guardian_contacts (full_name, phone, origin) values ('Mzazi Wengi', '+255899999999', 'front_desk') returning id",
      )
      const code = freshCode("X")
      // Another session on the same database (a second worktree's run) can
      // take a free Admission Number before this insert lands. Skip a taken
      // number and top up until there are exactly 5001.
      for (let have = 0; have < 5001; ) {
        const added = await sql.query(
          `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, guardian_contact_id, import_batch_id, referral_code,
                                     custodian_relationship)
           select 'ADMSN-' || lpad(n::text, 5, '0'), 'Many ' || n, 'STD 1', 2027, 'Day', 'Applied', $1, $2, $3, 'Mother'
           from generate_series(1, 99999) n
           where not exists (select 1 from public.leads l where l.admission_number = 'ADMSN-' || lpad(n::text, 5, '0'))
           limit $4
           on conflict (admission_number) do nothing`,
          [contact.rows[0].id, batch.rows[0].id, code, 5001 - have],
        )
        have += added.rowCount ?? 0
      }
      await actAs(sql, ADMISSIONS.id)
      return sql
        .query("select public.export_leads($1, array['admission_number'])", [{ import_batch_id: batch.rows[0].id }])
        .then(() => null, (error: Error & { detail?: string }) => ({ message: error.message, detail: JSON.parse(error.detail ?? "{}") }))
    })
    expect(answer).toEqual({ message: "too_many", detail: { row_count: 5001 } })
  })
})
