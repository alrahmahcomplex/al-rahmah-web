import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { listGroupLinks, setGroupLink } from "@/lib/services/group-links"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The WhatsApp group link for each Enrollment year (#183), through the
// group-links service against local Supabase, signed in as each seeded role.
// Each test works on a year of its own, far from the years leads use.

const usedYears = new Set<number>()

async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ year: number }>(
      `select year from generate_series(2100, 2999) as year
       where year <> all($1::integer[])
         and not exists (
           select 1 from public.whatsapp_group_links where enrollment_year = year
         )
       order by year limit 1`,
      [[...usedYears]],
    )
    if (!rows.length) {
      throw new Error(
        "No unused group-link test year remains (2100 to 2999). Reset the local test database with npm run db:reset.",
      )
    }
    usedYears.add(rows[0].year)
    return rows[0].year
  })
}

const inviteLink = () => `https://chat.whatsapp.com/${randomUUID().replaceAll("-", "").slice(0, 22)}`

async function linkFor(year: number) {
  const links = await listGroupLinks(await signedIn(ADMISSIONS))
  if (!links.ok) throw new Error(`could not read links: ${links.error}`)
  return links.data.find((link) => link.year === year) ?? null
}

test("year allocation fails clearly when every candidate is reserved", async () => {
  const previous = new Set(usedYears)
  try {
    for (let year = 2100; year <= 2999; year++) usedYears.add(year)
    await expect(unusedYear()).rejects.toThrow("Reset the local test database with npm run db:reset")
  } finally {
    usedYears.clear()
    for (const year of previous) usedYears.add(year)
  }
})

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
    // audit.view (#237), reports.view (#241) and the discount, import and
    // export permissions came after it.
    expect(data?.find((p) => p.name === "group_links.manage")).toEqual({ name: "group_links.manage", position: 19 })
    expect(data?.filter((p) => p.position === 20 || p.position === 21)).toEqual([
      { name: "audit.view", position: 20 },
      { name: "reports.view", position: 21 },
    ])
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

  for (const replacing of [false, true]) {
    test(`concurrent ${replacing ? "replacements" : "inserts"} save only the winner and its audit`, async () => {
      const year = await unusedYear()
      const [admissions, manager] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])
      const original = replacing ? inviteLink() : null
      if (original) {
        expect(await setGroupLink(admissions, year, original, null)).toEqual({ ok: true, data: null })
      }
      const candidates = [
        { client: admissions, person: ADMISSIONS, url: inviteLink() },
        { client: manager, person: MANAGER, url: inviteLink() },
      ]
      const results = await Promise.all(
        candidates.map(({ client, url }) => setGroupLink(client, year, url, original)),
      )
      expect(results.filter((result) => result.ok)).toEqual([{ ok: true, data: null }])
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "stale" }])
      const winner = candidates[results.findIndex((result) => result.ok)]
      expect(await linkFor(year)).toMatchObject({ url: winner.url, setByName: winner.person.name })

      const { data: row, error: rowError } = await admissions.from("whatsapp_group_links")
        .select("id").eq("enrollment_year", year).single()
      expect(rowError).toBeNull()
      const { data: history, error } = await (await signedIn(SUPER_ADMIN)).from("audit_log")
        .select("action, actor_staff_id, old_values, new_values")
        .eq("table_name", "whatsapp_group_links").eq("row_id", row!.id).order("id")
      expect(error).toBeNull()
      expect(history).toHaveLength(replacing ? 2 : 1)
      if (replacing) {
        expect(history![0]).toMatchObject({
          action: "insert", actor_staff_id: ADMISSIONS.id, new_values: { url: original },
        })
      }
      expect(history!.at(-1)).toMatchObject({
        action: replacing ? "update" : "insert",
        actor_staff_id: winner.person.id,
        ...(replacing ? { old_values: { url: original } } : {}),
        new_values: { url: winner.url },
      })
    })
  }

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

  test("each change is in the audit log under the lead scope, for the Super Admin (#237)", async () => {
    const year = await unusedYear()
    const first = inviteLink()
    const second = inviteLink()
    await setGroupLink(await signedIn(ADMISSIONS), year, first, null)
    await setGroupLink(await signedIn(MANAGER), year, second, first)

    const { data } = await (await signedIn(SUPER_ADMIN))
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
    const { data: history } = await (await signedIn(SUPER_ADMIN))
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
