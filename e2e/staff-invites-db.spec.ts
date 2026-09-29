import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "./db"
import { ACCOUNTANT, DEACTIVATED, INVITED, MANAGER, RETIRED_ROLE } from "./fixtures"

// The database side of inviting staff, called the way the invite service
// calls it: as the signed-in Manager with the publishable key. Sending the
// email is the secret key's job, so these tests use it only for that.

async function administrator(): Promise<SupabaseClient> {
  return signedIn(await createThrowawayStaff(["staff.administer"]))
}

async function roleId(name: string): Promise<string> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

function newEmail() {
  return `invitee-${randomUUID().slice(0, 8)}@example.test`
}

function expectRefusal(
  result: { error: { message: string; details: string | null } | null },
  code: string,
  details?: Record<string, unknown>,
) {
  expect(result.error?.message).toBe(code)
  if (details) expect(JSON.parse(result.error?.details ?? "{}")).toEqual(details)
}

async function invite(client: SupabaseClient, fullName: string, email: string, role = "Admissions Staff") {
  return client.rpc("invite_staff_member", { full_name: fullName, email, role_id: await roleId(role) })
}

async function sendInvite(email: string) {
  const { error } = await secretClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: "http://localhost:3100/auth/confirm",
  })
  if (error) throw new Error(`Could not send the invite to ${email}: ${error.message}`)
}

async function invitedIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.rpc("invited_staff_members")
  if (error) throw new Error(error.message)
  return data as string[]
}

test.describe("invite_staff_member", () => {
  test("anonymous visitors cannot call it", async () => {
    const { error } = await anonClient().rpc("invite_staff_member", {
      full_name: "Nobody",
      email: newEmail(),
      role_id: await roleId("Admissions Staff"),
    })

    expect(error).not.toBeNull()
  })

  test("not_permitted: a role without Administer staff and roles invites nobody", async () => {
    expectRefusal(await invite(await signedIn(ACCOUNTANT), "Zawadi Mrisho", newEmail()), "not_permitted", {
      role: "Accountant",
    })
  })

  test("creates an active staff member in the role, with no account, and one audit row naming the caller", async () => {
    const manager = await createThrowawayStaff(["staff.administer"])
    const client = await signedIn(manager)
    const email = newEmail()

    const { data, error } = await invite(client, "  Zawadi Mrisho ", `  ${email.toUpperCase()} `)

    expect(error).toBeNull()
    expect(data).toMatchObject({ name: "Zawadi Mrisho", role: "Admissions Staff", email })
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query(
        `select s.full_name, s.email, s.active, s.user_id, r.name as role,
                (select count(*)::int from public.audit_log a
                 where a.table_name = 'staff_members' and a.row_id = s.id
                   and a.action = 'insert' and a.actor_staff_id = $2) as audit_rows
         from public.staff_members s join public.roles r on r.id = s.role_id
         where s.id = $1`,
        [data.id, manager.id],
      ),
    )
    expect(rows[0]).toEqual({
      full_name: "Zawadi Mrisho",
      email,
      active: true,
      user_id: null,
      role: "Admissions Staff",
      audit_rows: 1,
    })
  })

  test("already_staff: an email on an active staff record is refused, whatever its case", async () => {
    expectRefusal(await invite(await administrator(), "Someone Else", MANAGER.email.toUpperCase()), "already_staff", {
      email: MANAGER.email,
      name: MANAGER.name,
      active: true,
    })
  })

  test("already_staff: an email on a deactivated staff record is refused too", async () => {
    expectRefusal(await invite(await administrator(), "Someone Else", DEACTIVATED.email), "already_staff", {
      email: DEACTIVATED.email,
      name: DEACTIVATED.name,
      active: false,
    })
  })

  test("role_retired: nobody is invited into a retired role", async () => {
    expectRefusal(await invite(await administrator(), "Zawadi Mrisho", newEmail(), RETIRED_ROLE.roleName), "role_retired", {
      role: RETIRED_ROLE.roleName,
    })
  })

  test("refuses an empty name, a malformed email and an unknown role", async () => {
    const client = await administrator()

    expectRefusal(await invite(client, "   ", newEmail()), "name_required")
    expectRefusal(await invite(client, "Zawadi Mrisho", "not-an-email"), "email_invalid")
    expectRefusal(
      await client.rpc("invite_staff_member", { full_name: "Zawadi Mrisho", email: newEmail(), role_id: randomUUID() }),
      "not_found",
    )
  })

  test("two Managers inviting the same email at once end with one record and one already_staff", async () => {
    const [first, second] = await Promise.all([administrator(), administrator()])
    const email = newEmail()

    const results = await Promise.all([invite(first, "Zawadi Mrisho", email), invite(second, "Zawadi Mrisho", email)])

    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    expect(results.filter((r) => r.error?.message === "already_staff")).toHaveLength(1)
  })

  test("the sign-up trigger then lets the invite create the account, linked to the record", async () => {
    const client = await administrator()
    const email = newEmail()
    const { data } = await invite(client, "Zawadi Mrisho", email)

    await sendInvite(email)

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ linked: boolean }>(
        "select s.user_id = u.id as linked from public.staff_members s join auth.users u on u.email = s.email where s.id = $1",
        [data.id],
      ),
    )
    expect(rows[0].linked).toBe(true)
  })
})

test.describe("who counts as Invited", () => {
  test("a record with no account, and an account whose invite is not yet accepted, are Invited; accepting joins", async () => {
    const client = await administrator()
    const email = newEmail()
    const { data } = await invite(client, "Zawadi Mrisho", email)

    expect(await invitedIds(client)).toContain(data.id)

    await sendInvite(email)
    expect(await invitedIds(client)).toContain(data.id)

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [data.id]),
    )
    // What accepting the invite does to the account.
    await secretClient().auth.admin.updateUserById(rows[0].user_id, { email_confirm: true, password: "fixture-password" })
    expect(await invitedIds(client)).not.toContain(data.id)
  })

  test("seeded staff with accounts are not Invited, and the seeded Invited member is", async () => {
    const ids = await invitedIds(await administrator())

    expect(ids).toContain(INVITED.id)
    expect(ids).not.toContain(MANAGER.id)
    expect(ids).not.toContain(DEACTIVATED.id)
  })

  test("someone who does not administer staff learns nothing from it", async () => {
    expect(await invitedIds(await signedIn(ACCOUNTANT))).toEqual([])
  })
})

test.describe("resendable_invite", () => {
  test("names the Invited member and the email to send to", async () => {
    const { data, error } = await (await administrator()).rpc("resendable_invite", { staff_id: INVITED.id })

    expect(error).toBeNull()
    expect(data).toEqual({ id: INVITED.id, name: INVITED.name, role: INVITED.roleName, email: INVITED.email })
  })

  test("not_permitted: a role without Administer staff and roles learns nothing", async () => {
    expectRefusal(await (await signedIn(ACCOUNTANT)).rpc("resendable_invite", { staff_id: INVITED.id }), "not_permitted")
  })

  test("already_joined: someone who has accepted their invite is sent no invite", async () => {
    expectRefusal(await (await administrator()).rpc("resendable_invite", { staff_id: MANAGER.id }), "already_joined", {
      name: MANAGER.name,
    })
  })

  test("invite_deactivated: a deactivated Invited member is sent no invite", async () => {
    const client = await administrator()
    const email = newEmail()
    const { data } = await invite(client, "Zawadi Mrisho", email)
    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [data.id]))

    expectRefusal(await client.rpc("resendable_invite", { staff_id: data.id }), "invite_deactivated", {
      name: "Zawadi Mrisho",
    })
  })

  test("refuses an unknown staff member", async () => {
    expectRefusal(await (await administrator()).rpc("resendable_invite", { staff_id: randomUUID() }), "not_found")
  })
})
