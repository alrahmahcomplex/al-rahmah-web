import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { renderGroupInvitation } from "@/lib/group-invitation"
import { tanzaniaToday } from "@/lib/school-calendar"
import { countInvitedFamilies, getGroupInvitation, sendGroupInvitation } from "@/lib/services/group-invitations"
import { setGroupLink } from "@/lib/services/group-links"
import { createLead, searchLeads } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Sending the admissions WhatsApp group invitation (#186), through the
// group-invitations service against local Supabase, signed in as each seeded
// role. Each test moves its own leads to an Enrollment year of its own (2030
// to 2099, clear of the years real leads and the group-link tests use), so
// one test's link never reaches another's leads.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))
const usedYears = new Set<number>()

async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ year: number }>(
      `select year from generate_series(2030, 2099) as year
       where year <> all($1::integer[])
         and not exists (select 1 from public.whatsapp_group_links where enrollment_year = year)
         and not exists (select 1 from public.leads where enrollment_year = year)
       order by year limit 1`,
      [[...usedYears]],
    )
    if (!rows.length) {
      throw new Error("No unused group-invitation test year remains (2030 to 2099). Reset the local test database with npm run db:reset.")
    }
    usedYears.add(rows[0].year)
    return rows[0].year
  })
}

const inviteLink = () => `https://chat.whatsapp.com/${randomUUID().replaceAll("-", "").slice(0, 22)}`

// A number of the test's own, clear of the seeded 700 000 numbers.
const mobile = () => `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`

type Family = { contactId: string }

// A Visited walk-in lead, or with `form` an Applied one, moved to `year`.
// With `family`, a sibling on that Family's contact.
async function visitedLead(year: number, options: { family?: Family; whatsapp?: string; form?: boolean } = {}) {
  const studentName = `Invitee ${randomUUID().slice(0, 8)}`
  // The Admission form writes with the secret key, as the public form does.
  const created = await createLead(options.form ? secretClient() : await signedIn(ADMISSIONS), {
    guardian: options.family
      ? { contactId: options.family.contactId }
      : { contact: { fullName: "Invitation Parent", relationship: "Mother", phone: mobile(), whatsapp: options.whatsapp } },
    student: { fullName: studentName, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: options.form ? { kind: "admission-form" } : { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  const contactId = await asSystem(async (sql) => {
    await sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year])
    return (await sql.query<{ id: string }>("select guardian_contact_id as id from public.leads where id = $1", [leadId])).rows[0].id
  })
  return { leadId, studentName, family: { contactId } }
}

async function saveLink(year: number, link = inviteLink(), seen: string | null = null) {
  const saved = await setGroupLink(await signedIn(MANAGER), year, link, seen)
  if (!saved.ok) throw new Error(`could not save the link: ${saved.error}`)
  return link
}

async function rowsFor(leadId: string) {
  return inRolledBackTransaction(async (sql) =>
    (await sql.query("select * from public.whatsapp_group_invitations where lead_id = $1 order by sent_at", [leadId])).rows,
  )
}

async function setPhones(contactId: string, phone: string, whatsapp: string) {
  await asSystem((sql) =>
    sql.query("update public.guardian_contacts set phone = $2, whatsapp = $3 where id = $1", [contactId, phone, whatsapp]),
  )
}

async function close(leadId: string, state: "Declined" | "Inactive" | "Archived") {
  const change =
    state === "Declined"
      ? "status = 'Declined', declined_reason = 'School decision'"
      : `closure = '${state}', closure_reason = 'Duplicate record'`
  await asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [leadId]))
}

describe("sending", () => {
  test("Admissions Staff send to the WhatsApp contact, and the send is recorded in full", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const whatsapp = mobile()
    const lead = await visitedLead(year, { whatsapp })
    const before = Date.now()

    const sent = await sendGroupInvitation(await signedIn(ADMISSIONS), lead.leadId, "link", link, year)
    if (!sent.ok) throw new Error(sent.error)
    expect(sent.data.channel).toBe("whatsapp")
    const message = renderGroupInvitation(year, link)
    if (!message.ok) throw new Error(message.error)
    expect(sent.data.link).toBe(`https://wa.me/255${whatsapp.slice(1)}?text=${encodeURIComponent(message.data)}`)

    const rows = await rowsFor(lead.leadId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      enrollment_year: year,
      url: link,
      template_version: "group_invitation_v2",
      channel: "whatsapp",
      sibling_lead_ids: [],
      sent_by: ADMISSIONS.id,
    })
    expect(new Date(rows[0].sent_at).getTime()).toBeGreaterThanOrEqual(before - 60_000)

    const { data: history } = await (await signedIn(ADMISSIONS))
      .from("audit_log")
      .select("action, scope, lead_id, actor_staff_id")
      .eq("table_name", "whatsapp_group_invitations")
      .eq("row_id", rows[0].id)
    expect(history).toEqual([{ action: "insert", scope: "lead", lead_id: lead.leadId, actor_staff_id: ADMISSIONS.id }])
  })

  test("with no separate WhatsApp number, the link opens the direct phone", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)

    const view = await getGroupInvitation(await signedIn(ADMISSIONS), lead.leadId)
    expect(view.ok && view.data.offer).toMatchObject({ channel: "phone", url: link })
    const sent = await sendGroupInvitation(await signedIn(MANAGER), lead.leadId, "link", link, year)
    expect(sent.ok && sent.data.channel).toBe("phone")
    expect((await rowsFor(lead.leadId))[0]).toMatchObject({ channel: "phone", sent_by: MANAGER.id })
  })

  test("with no Tanzanian mobile, a link is refused and a copy is recorded", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    await setPhones(lead.family.contactId, "+255222123456", "+255222123456")

    const staff = await signedIn(ADMISSIONS)
    const view = await getGroupInvitation(staff, lead.leadId)
    expect(view.ok && view.data.offer).toMatchObject({ channel: "copy", phone: null })
    expect(await sendGroupInvitation(staff, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "no_whatsapp_number" })
    expect(await rowsFor(lead.leadId)).toHaveLength(0)

    expect(await sendGroupInvitation(staff, lead.leadId, "copy", link, year)).toEqual({
      ok: true,
      data: { channel: "copy", link: null, siblingLeadIds: [] },
    })
    expect((await rowsFor(lead.leadId))[0]).toMatchObject({ channel: "copy", url: link })
  })

  test("the button stays available, and each resend is a row of its own", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    const staff = await signedIn(ADMISSIONS)
    await sendGroupInvitation(staff, lead.leadId, "link", link, year)
    await sendGroupInvitation(staff, lead.leadId, "link", link, year)

    expect(await rowsFor(lead.leadId)).toHaveLength(2)
    const view = await getGroupInvitation(staff, lead.leadId)
    expect(view.ok && view.data.blocked).toBeNull()
    expect(view.ok && view.data.latest).toMatchObject({ year, sentBy: ADMISSIONS.name, withNames: [], earlierLink: false })
  })
})

describe("refusals", () => {
  for (const state of ["Declined", "Inactive", "Archived"] as const) {
    test(`a ${state} lead is refused and shows no button, but keeps its earlier invitation`, async () => {
      const year = await unusedYear()
      const link = await saveLink(year)
      const lead = await visitedLead(year)
      const staff = await signedIn(ADMISSIONS)
      await sendGroupInvitation(staff, lead.leadId, "link", link, year)
      await close(lead.leadId, state)

      expect(await sendGroupInvitation(staff, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "lead_closed" })
      expect(await sendGroupInvitation(staff, lead.leadId, "copy", link, year)).toEqual({ ok: false, error: "lead_closed" })
      expect(await rowsFor(lead.leadId)).toHaveLength(1)
      const view = await getGroupInvitation(staff, lead.leadId)
      expect(view.ok && view.data).toMatchObject({ blocked: "lead_closed", offer: null, latest: { year } })
    })
  }

  test("a reopened lead gets the button back", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    await close(lead.leadId, "Inactive")
    await asSystem(async (sql) => {
      await sql.query("select public.set_lead_lifecycle_override('reopen')")
      await sql.query("update public.leads set closure = null, closure_reason = null where id = $1", [lead.leadId])
    })

    const view = await getGroupInvitation(await signedIn(ADMISSIONS), lead.leadId)
    expect(view.ok && view.data.blocked).toBeNull()
    expect((await sendGroupInvitation(await signedIn(ADMISSIONS), lead.leadId, "link", link, year)).ok).toBe(true)
  })

  test("an Applied lead is refused until the family has visited", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year, { form: true })

    const staff = await signedIn(ADMISSIONS)
    expect(await getGroupInvitation(staff, lead.leadId)).toMatchObject({ ok: true, data: { blocked: "not_visited", offer: null } })
    expect(await sendGroupInvitation(staff, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "not_visited" })
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })

  test("a year with no link saved is refused, and the view says so", async () => {
    const year = await unusedYear()
    const lead = await visitedLead(year)

    const staff = await signedIn(ADMISSIONS)
    const view = await getGroupInvitation(staff, lead.leadId)
    expect(view.ok && view.data).toMatchObject({ year, blocked: "no_link", offer: null, latest: null })
    expect(await sendGroupInvitation(staff, lead.leadId, "link", inviteLink(), year)).toEqual({ ok: false, error: "no_link" })
  })

  test("a link replaced since the page was built, or a changed year, is refused as stale", async () => {
    const year = await unusedYear()
    const first = await saveLink(year)
    const second = await saveLink(year, inviteLink(), first)
    const lead = await visitedLead(year)

    const staff = await signedIn(ADMISSIONS)
    expect(await sendGroupInvitation(staff, lead.leadId, "link", first, year)).toEqual({ ok: false, error: "stale_link" })
    expect(await sendGroupInvitation(staff, lead.leadId, "copy", first, year)).toEqual({ ok: false, error: "stale_link" })
    expect(await sendGroupInvitation(staff, lead.leadId, "link", second, year + 1)).toEqual({ ok: false, error: "stale_link" })
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })

  test("a link too long for the message is refused before anything is recorded", async () => {
    const year = await unusedYear()
    const link = await saveLink(year, `https://chat.whatsapp.com/${"A".repeat(174)}`)
    const lead = await visitedLead(year)

    const staff = await signedIn(ADMISSIONS)
    const view = await getGroupInvitation(staff, lead.leadId)
    expect(view.ok && view.data.offer).toMatchObject({ url: link, message: null })
    expect(await sendGroupInvitation(staff, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "too_long" })
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })
})

describe("who may send", () => {
  test("the Accountant reads the section but may not send", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)

    const accountant = await signedIn(ACCOUNTANT)
    const view = await getGroupInvitation(accountant, lead.leadId)
    expect(view.ok && view.data).toMatchObject({ canSend: false, blocked: null, offer: null })
    expect(await sendGroupInvitation(accountant, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "forbidden" })
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })

  test("a role holding leads.edit may send; one with only leads.view may not", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)

    const editor = await signedIn(await createThrowawayStaff(["leads.view", "leads.edit"]))
    expect((await sendGroupInvitation(editor, lead.leadId, "link", link, year)).ok).toBe(true)
    const viewer = await signedIn(await createThrowawayStaff(["leads.view"]))
    expect(await sendGroupInvitation(viewer, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "forbidden" })
    expect(await rowsFor(lead.leadId)).toHaveLength(1)
  })

  test("signed-out visitors and staff without leads.view read and send nothing", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    await sendGroupInvitation(await signedIn(ADMISSIONS), lead.leadId, "link", link, year)

    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [anonClient(), outsider]) {
      expect(await getGroupInvitation(client, lead.leadId)).toEqual({ ok: false, error: "forbidden" })
      expect(await sendGroupInvitation(client, lead.leadId, "link", link, year)).toEqual({ ok: false, error: "forbidden" })
      expect(await countInvitedFamilies(client, year)).toEqual({ ok: false, error: "forbidden" })
      expect((await client.from("whatsapp_group_invitations").select("id").eq("lead_id", lead.leadId)).data).toEqual([])
    }
    expect(await rowsFor(lead.leadId)).toHaveLength(1)
  })

  test("a bad method or template version is refused", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    const staff = await signedIn(ADMISSIONS)
    const call = (method: string, template: string) =>
      staff.rpc("send_group_invitation", {
        lead_id: lead.leadId,
        method,
        link_year: year,
        link_seen: link,
        template_version: template,
      })
    expect((await call("sms", "group_invitation_v2")).error?.message).toBe("invalid_method")
    expect((await call("link", "whatsapp_passed_v1")).error?.message).toBe("invalid_template")
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })
})

describe("siblings", () => {
  test("the confirmed Family's other children in the year are captured, and each sees the invitation", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const sender = await visitedLead(year)
    const sibling = await visitedLead(year, { family: sender.family })
    const otherYear = await visitedLead(year, { family: sender.family })
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [otherYear.leadId, thisYear + 1]))

    const sent = await sendGroupInvitation(await signedIn(ADMISSIONS), sender.leadId, "link", link, year)
    expect(sent.ok && sent.data.siblingLeadIds).toEqual([sibling.leadId])
    expect((await rowsFor(sender.leadId))[0].sibling_lead_ids).toEqual([sibling.leadId])

    const staff = await signedIn(ADMISSIONS)
    const onSibling = await getGroupInvitation(staff, sibling.leadId)
    expect(onSibling.ok && onSibling.data.latest).toMatchObject({
      fromLeadId: sender.leadId,
      withNames: [sender.studentName],
      sentBy: ADMISSIONS.name,
    })
    const onSender = await getGroupInvitation(staff, sender.leadId)
    expect(onSender.ok && onSender.data.latest?.withNames).toEqual([sibling.studentName])
    const onOtherYear = await getGroupInvitation(staff, otherYear.leadId)
    expect(onOtherYear.ok && onOtherYear.data.latest).toBeNull()

    expect(await countInvitedFamilies(staff, year)).toEqual({ ok: true, data: 1 })
  })

  test("the siblings recorded stay as they were when the Family later changes", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const sender = await visitedLead(year)
    const sibling = await visitedLead(year, { family: sender.family })
    await sendGroupInvitation(await signedIn(ADMISSIONS), sender.leadId, "link", link, year)
    const late = await visitedLead(year, { family: sender.family })

    expect((await rowsFor(sender.leadId))[0].sibling_lead_ids).toEqual([sibling.leadId])
    const onLate = await getGroupInvitation(await signedIn(ADMISSIONS), late.leadId)
    expect(onLate.ok && onLate.data.latest).toBeNull()
  })

  test("a contact with an unconfirmed Family match captures no siblings", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const sender = await visitedLead(year)
    await visitedLead(year, { family: sender.family })
    const elsewhere = await visitedLead(year)
    await asSystem((sql) =>
      sql.query("update public.guardian_contacts set pending_family_match_id = $2 where id = $1", [
        sender.family.contactId,
        elsewhere.family.contactId,
      ]),
    )

    const sent = await sendGroupInvitation(await signedIn(ADMISSIONS), sender.leadId, "link", link, year)
    expect(sent.ok && sent.data.siblingLeadIds).toEqual([])
  })
})

describe("an earlier link", () => {
  test("once the link is replaced, the lead and its sibling are marked and found by the filter, until resent", async () => {
    const year = await unusedYear()
    const first = await saveLink(year)
    const sender = await visitedLead(year)
    const sibling = await visitedLead(year, { family: sender.family })
    const current = await visitedLead(year)
    const notInvited = await visitedLead(year)
    const staff = await signedIn(ADMISSIONS)
    await sendGroupInvitation(staff, sender.leadId, "link", first, year)

    const before = await getGroupInvitation(staff, sender.leadId)
    expect(before.ok && before.data.latest?.earlierLink).toBe(false)

    const second = await saveLink(year, inviteLink(), first)
    await sendGroupInvitation(staff, current.leadId, "link", second, year)

    for (const id of [sender.leadId, sibling.leadId]) {
      const view = await getGroupInvitation(staff, id)
      expect(view.ok && view.data.latest?.earlierLink).toBe(true)
    }
    const fresh = await getGroupInvitation(staff, current.leadId)
    expect(fresh.ok && fresh.data.latest?.earlierLink).toBe(false)

    const found = async () => {
      const listed = await searchLeads(staff, { earlierLinkYear: year, closure: "all", page: 1 })
      if (!listed.ok) throw new Error(listed.error)
      return listed.data.leads.map((lead) => lead.id).sort()
    }
    expect(await found()).toEqual([sender.leadId, sibling.leadId].sort())
    expect(await found()).not.toContain(notInvited.leadId)

    // The filter is for the year asked about.
    const other = await searchLeads(staff, { earlierLinkYear: year + 1, closure: "all", page: 1 })
    expect(other.ok && other.data.total).toBe(0)

    // Resent with the current link: the family drops out.
    await sendGroupInvitation(staff, sender.leadId, "link", second, year)
    expect(await found()).toEqual([])
    const after = await getGroupInvitation(staff, sibling.leadId)
    expect(after.ok && after.data.latest?.earlierLink).toBe(false)
  })

  test("the filter still applies the other list filters", async () => {
    const year = await unusedYear()
    const first = await saveLink(year)
    const open = await visitedLead(year)
    const archived = await visitedLead(year)
    const staff = await signedIn(ADMISSIONS)
    await sendGroupInvitation(staff, open.leadId, "link", first, year)
    await sendGroupInvitation(staff, archived.leadId, "link", first, year)
    await saveLink(year, inviteLink(), first)
    await close(archived.leadId, "Archived")

    const listed = await searchLeads(staff, { earlierLinkYear: year, page: 1 })
    expect(listed.ok && listed.data.leads.map((lead) => lead.id)).toEqual([open.leadId])
    expect(listed.ok && listed.data.total).toBe(1)
  })
})

describe("families invited", () => {
  test("counts distinct families, not sends or children", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const first = await visitedLead(year)
    const sibling = await visitedLead(year, { family: first.family })
    const second = await visitedLead(year)
    const staff = await signedIn(ADMISSIONS)

    expect(await countInvitedFamilies(staff, year)).toEqual({ ok: true, data: 0 })
    await sendGroupInvitation(staff, first.leadId, "link", link, year)
    await sendGroupInvitation(staff, first.leadId, "link", link, year)
    await sendGroupInvitation(staff, sibling.leadId, "link", link, year)
    await sendGroupInvitation(staff, second.leadId, "link", link, year)
    expect(await countInvitedFamilies(staff, year)).toEqual({ ok: true, data: 2 })
    expect(await countInvitedFamilies(await signedIn(ACCOUNTANT), year)).toEqual({ ok: true, data: 2 })
  })
})

describe("the invitations table", () => {
  test("nobody writes it directly through the API, the secret key included", async () => {
    const year = await unusedYear()
    const lead = await visitedLead(year)
    const row = {
      lead_id: lead.leadId,
      enrollment_year: year,
      url: inviteLink(),
      template_version: "group_invitation_v2",
      channel: "copy",
      sent_by: MANAGER.id,
    }
    for (const client of [await signedIn(MANAGER), secretClient()]) {
      const { error } = await client.from("whatsapp_group_invitations").insert(row)
      expect(error?.code).toBe("42501")
    }
    expect(await rowsFor(lead.leadId)).toHaveLength(0)
  })

  test("a row is never changed or deleted, by the database owner either", async () => {
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    await sendGroupInvitation(await signedIn(ADMISSIONS), lead.leadId, "link", link, year)

    await expect(
      asSystem((sql) => sql.query("update public.whatsapp_group_invitations set channel = 'copy' where lead_id = $1", [lead.leadId])),
    ).rejects.toThrow("update_refused")
    await expect(
      asSystem((sql) => sql.query("delete from public.whatsapp_group_invitations where lead_id = $1", [lead.leadId])),
    ).rejects.toThrow("delete_refused")
    expect((await rowsFor(lead.leadId))[0]).toMatchObject({ channel: "phone" })
  })
})
