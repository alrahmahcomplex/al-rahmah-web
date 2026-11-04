import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { listGroupLinks, setGroupLink } from "@/lib/services/group-links"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  lockExclusively,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The WhatsApp group link for each Enrollment year (#183), through the
// group-links service against local Supabase, signed in as each seeded role.
// Each test works on a year of its own, far from the years leads use.

const usedYears = new Set<number>()

async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const year = randomInt(2100, 3000)
      if (usedYears.has(year)) continue
      const taken = await sql.query("select 1 from public.whatsapp_group_links where enrollment_year = $1", [year])
      if (taken.rowCount === 0) {
        usedYears.add(year)
        return year
      }
    }
  })
}

const inviteLink = () => `https://chat.whatsapp.com/${randomUUID().replaceAll("-", "").slice(0, 22)}`

async function linkFor(year: number) {
  const links = await listGroupLinks(await signedIn(ADMISSIONS))
  if (!links.ok) throw new Error(`could not read links: ${links.error}`)
  return links.data.find((link) => link.year === year) ?? null
}

describe("the group-link permission on a fresh database", () => {
  test("every starting role holding leads.edit has it, and the Accountant does not", async () => {
    const { data } = await secretClient().from("roles").select("name, permissions").eq("retired", false)
    const holders = (data ?? []).filter((role) => role.permissions.includes("group_links.manage")).map((role) => role.name)

    expect(holders).toContain("Admissions Staff")
    expect(holders).toContain("Admissions Manager")
    expect(holders).not.toContain("Accountant")
  })

  test("takes the next position in the permission list", async () => {
    const { data } = await secretClient().from("permissions").select("name, position").order("position")
    expect(data?.at(-1)).toEqual({ name: "group_links.manage", position: 19 })
  })

  // A fresh database has no staff yet, so nobody administers. Changing the
  // Manager's role then used to be refused as no_administrator_left; a change
  // that leaves the role administering is now allowed, and one that takes the
  // power away is still refused.
  test("a role update that keeps staff.administer passes with no administrator left; removing it does not", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await lockExclusively(sql, ["public.staff_members", "public.roles"])
      await sql.query("set local session_replication_role = replica")
      await sql.query("update public.staff_members set active = false")
      await sql.query("set local session_replication_role = origin")
      const { rows } = await sql.query<{ count: number }>("select public.administrator_count() as count")
      expect(Number(rows[0].count)).toBe(0)

      await sql.query(
        `update public.roles set permissions = array_remove(permissions, 'group_links.manage')
         where name = 'Admissions Manager'`,
      )
      await sql.query(
        `update public.roles set permissions = array_append(permissions, 'group_links.manage')
         where name = 'Admissions Manager'`,
      )
      await expect(
        sql.query(
          `update public.roles set permissions = array_remove(permissions, 'staff.administer')
           where name = 'Admissions Manager'`,
        ),
      ).rejects.toThrow("no_administrator_left")
    })
  })
})

describe("setting a year's group link", () => {
  test("Admissions Staff save a link, and staff read it back with who set it and when", async () => {
    const year = await unusedYear()
    const link = inviteLink()
    const before = Date.now()

    expect(await setGroupLink(await signedIn(ADMISSIONS), year, link, null)).toEqual({ ok: true, data: null })

    const saved = await linkFor(year)
    expect(saved).toMatchObject({ year, url: link, setByName: ADMISSIONS.name })
    expect(new Date(saved!.setAt).getTime()).toBeGreaterThanOrEqual(before - 60_000)
  })

  test("the Manager replaces it, giving the link they saw", async () => {
    const year = await unusedYear()
    const first = inviteLink()
    const second = inviteLink()
    await setGroupLink(await signedIn(ADMISSIONS), year, first, null)

    expect(await setGroupLink(await signedIn(MANAGER), year, second, first)).toEqual({ ok: true, data: null })
    expect(await linkFor(year)).toMatchObject({ url: second, setByName: MANAGER.name })
  })

  test("a replacement based on an out-of-date link is refused as stale", async () => {
    const year = await unusedYear()
    const first = inviteLink()
    const second = inviteLink()
    await setGroupLink(await signedIn(ADMISSIONS), year, first, null)
    await setGroupLink(await signedIn(MANAGER), year, second, first)

    expect(await setGroupLink(await signedIn(ADMISSIONS), year, inviteLink(), first)).toEqual({
      ok: false,
      error: "stale",
    })
    expect(await setGroupLink(await signedIn(ADMISSIONS), year, inviteLink(), null)).toEqual({
      ok: false,
      error: "stale",
    })
    expect((await linkFor(year))?.url).toBe(second)
  })

  test("surrounding spaces are trimmed before the link is checked and saved", async () => {
    const year = await unusedYear()
    const link = inviteLink()
    expect(await setGroupLink(await signedIn(ADMISSIONS), year, `  ${link}\n`, null)).toEqual({ ok: true, data: null })
    expect((await linkFor(year))?.url).toBe(link)
  })

  test("a link with WhatsApp's own query string is accepted", async () => {
    const year = await unusedYear()
    const link = `${inviteLink()}?mode=ems_copy_t`
    expect(await setGroupLink(await signedIn(ADMISSIONS), year, link, null)).toEqual({ ok: true, data: null })
  })

  test("the Accountant, without the permission, is refused and nothing is saved", async () => {
    const year = await unusedYear()
    expect(await setGroupLink(await signedIn(ACCOUNTANT), year, inviteLink(), null)).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await linkFor(year)).toBeNull()
  })

  test("a role created after the migration holding leads.edit does not get the permission", async () => {
    const year = await unusedYear()
    const editor = await signedIn(await createThrowawayStaff(["leads.view", "leads.edit"]))
    expect(await setGroupLink(editor, year, inviteLink(), null)).toEqual({ ok: false, error: "forbidden" })
  })

  test("a role given only the permission may set the link", async () => {
    const year = await unusedYear()
    const setter = await signedIn(await createThrowawayStaff(["group_links.manage"]))
    expect(await setGroupLink(setter, year, inviteLink(), null)).toEqual({ ok: true, data: null })
  })

  test("a signed-out visitor is refused", async () => {
    const year = await unusedYear()
    expect(await setGroupLink(anonClient(), year, inviteLink(), null)).toEqual({ ok: false, error: "forbidden" })
  })

  const INVALID = [
    "",
    "chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv",
    "http://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv",
    "https://chat.whatsapp.com/",
    "https://chat.whatsapp.com.example.com/AbCdEfGhIjKlMnOpQrStUv",
    "https://wa.me/255712345678",
    "https://chat.whatsapp.com/AbCd EfGh",
    "https://chat.whatsapp.com/AbCd\nUnaombwa kulipa",
    "https://chat.whatsapp.com/AbCd/../../evil",
    `https://chat.whatsapp.com/${"a".repeat(300)}`,
  ]
  for (const link of INVALID) {
    test(`an invalid link is rejected: ${JSON.stringify(link.slice(0, 60))}`, async () => {
      const year = await unusedYear()
      expect(await setGroupLink(await signedIn(ADMISSIONS), year, link, null)).toEqual({
        ok: false,
        error: "invalid-link",
      })
      expect(await linkFor(year)).toBeNull()
    })
  }

  test("a year outside 2000 to 2999 is rejected", async () => {
    expect(await setGroupLink(await signedIn(ADMISSIONS), 1999, inviteLink(), null)).toEqual({
      ok: false,
      error: "invalid-year",
    })
  })
})

describe("reading the group links", () => {
  test("staff with leads.view read them, the Accountant included", async () => {
    const year = await unusedYear()
    const link = inviteLink()
    await setGroupLink(await signedIn(ADMISSIONS), year, link, null)

    const read = await listGroupLinks(await signedIn(ACCOUNTANT))
    expect(read.ok && read.data.find((each) => each.year === year)?.url).toBe(link)

    const { data } = await (await signedIn(ACCOUNTANT))
      .from("whatsapp_group_links")
      .select("url")
      .eq("enrollment_year", year)
    expect(data).toEqual([{ url: link }])
  })

  test("staff without leads.view, and signed-out visitors, read nothing", async () => {
    const year = await unusedYear()
    await setGroupLink(await signedIn(ADMISSIONS), year, inviteLink(), null)

    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    expect(await listGroupLinks(outsider)).toEqual({ ok: false, error: "forbidden" })
    expect(await listGroupLinks(anonClient())).toEqual({ ok: false, error: "forbidden" })
    expect((await outsider.from("whatsapp_group_links").select("url")).data).toEqual([])
    expect((await anonClient().from("whatsapp_group_links").select("url")).data).toEqual([])
  })
})

describe("the links table", () => {
  test("nobody writes it directly through the API, the secret key included", async () => {
    const year = await unusedYear()
    const row = { enrollment_year: year, url: inviteLink() }
    for (const client of [await signedIn(MANAGER), secretClient()]) {
      const { error } = await client.from("whatsapp_group_links").insert(row)
      expect(error?.code).toBe("42501")
    }
    expect(await linkFor(year)).toBeNull()
  })

  test("a link is never deleted, by the database owner either", async () => {
    const year = await unusedYear()
    await setGroupLink(await signedIn(ADMISSIONS), year, inviteLink(), null)

    await expect(
      asSystem((sql) => sql.query("delete from public.whatsapp_group_links where enrollment_year = $1", [year])),
    ).rejects.toThrow("delete_refused")
    expect(await linkFor(year)).not.toBeNull()
  })

  test("the table refuses a link that isn't a WhatsApp group link, for the database owner too", async () => {
    const year = await unusedYear()
    await expect(
      asSystem((sql) =>
        sql.query(
          `insert into public.whatsapp_group_links (enrollment_year, url, set_by)
           values ($1, 'https://example.com/x', $2)`,
          [year, MANAGER.id],
        ),
      ),
    ).rejects.toThrow()
  })

  test("each change is in the audit log under the lead scope, for staff who view leads", async () => {
    const year = await unusedYear()
    const first = inviteLink()
    const second = inviteLink()
    await setGroupLink(await signedIn(ADMISSIONS), year, first, null)
    await setGroupLink(await signedIn(MANAGER), year, second, first)

    const { data } = await (await signedIn(ADMISSIONS))
      .from("audit_log")
      .select("action, scope, actor_staff_id, old_values, new_values")
      .eq("table_name", "whatsapp_group_links")
      .eq("new_values->>enrollment_year", String(year))
    expect(data).toHaveLength(1)

    const { data: rowId } = await secretClient()
      .from("whatsapp_group_links")
      .select("id")
      .eq("enrollment_year", year)
      .single()
    const { data: history } = await (await signedIn(ADMISSIONS))
      .from("audit_log")
      .select("action, scope, actor_staff_id, old_values, new_values")
      .eq("table_name", "whatsapp_group_links")
      .eq("row_id", rowId!.id)
      .order("id")
    expect(history).toMatchObject([
      { action: "insert", scope: "lead", actor_staff_id: ADMISSIONS.id, new_values: { url: first } },
      { action: "update", scope: "lead", actor_staff_id: MANAGER.id, old_values: { url: first }, new_values: { url: second } },
    ])
  })
})
