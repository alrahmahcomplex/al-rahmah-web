import { describe, expect, test } from "vitest"

import { inRolledBackTransaction, signedIn } from "../support/db"
import { SUPER_ADMIN } from "../support/fixtures"

// The Super Admin's email (owner decision of 2026-11-09): the holder's staff
// record carries marketing.alrahmah@gmail.com, the name stays Al-Rahmah
// Complex, and the freeze on the holder is back in place after the change.

describe("the Super Admin's email", () => {
  test("is marketing.alrahmah@gmail.com, the name is unchanged, and the local login signs in with it", async () => {
    const holder = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ full_name: string; email: string }>("select full_name, email from public.staff_members where id = $1", [
        SUPER_ADMIN.id,
      ])
      return rows[0]
    })
    expect(holder).toEqual({ full_name: "Al-Rahmah Complex", email: "marketing.alrahmah@gmail.com" })
    expect(SUPER_ADMIN.email).toBe("marketing.alrahmah@gmail.com")
    const { data } = await (await signedIn(SUPER_ADMIN)).rpc("current_staff_member").single<{ id: string }>()
    expect(data?.id).toBe(SUPER_ADMIN.id)
  })

  test("the change is in the audit history as the system, and the holder is frozen again", async () => {
    const outcome = await inRolledBackTransaction(async (sql) => {
      const audit = await sql.query<{ actor_kind: string; old_values: { email: string }; new_values: { email: string } }>(
        `select actor_kind, old_values, new_values from public.audit_log
         where table_name = 'staff_members' and row_id = $1 and action = 'update' and new_values ? 'email'
         order by created_at desc limit 1`,
        [SUPER_ADMIN.id],
      )
      const trigger = await sql.query<{ enabled: string }>(
        "select tgenabled as enabled from pg_trigger where tgname = 'refuse_super_admin_holder_change' and tgrelid = 'public.staff_members'::regclass",
      )
      await sql.query("select public.set_audit_actor('system')")
      const change = await sql
        .query("update public.staff_members set email = 'someone-else@example.test' where id = $1", [SUPER_ADMIN.id])
        .then(() => "changed", (error: Error) => error.message)
      return { audit: audit.rows[0], enabled: trigger.rows[0].enabled, change }
    })
    expect(outcome).toEqual({
      audit: { actor_kind: "system", old_values: { email: "alrahmahcomplex.tz@gmail.com" }, new_values: { email: "marketing.alrahmah@gmail.com" } },
      enabled: "O",
      change: "super_admin_frozen",
    })
  })
})
