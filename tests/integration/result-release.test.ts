import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { renderResultMessage } from "@/lib/result-messages"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { getResultRelease, getResultReleases, releaseResult } from "@/lib/services/result-release"

import { anonClient, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "../support/fixtures"

// Releasing an interview result through the result-release module, against
// local Supabase. The seeded slice 6 leads are only read, and refusals record
// nothing; every release happens on a lead of the test's own.

const OFFICE = { officePhone: "+255 673 526 644" }
const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// supabase/seeds/60_results.sql and 50_interviews.sql.
const SEEDED = {
  // Passed, Paid, with a separate WhatsApp number.
  whatsapp: { lead: "1ead0000-0000-4000-8000-000000000601", interview: "1e7e0000-0000-4000-8000-000000000601" },
  // Failed, Paid, direct phone only.
  directOnly: { lead: "1ead0000-0000-4000-8000-000000000602", interview: "1e7e0000-0000-4000-8000-000000000602" },
  // Passed, Not Paid.
  notPaid: { lead: "1ead0000-0000-4000-8000-000000000603", interview: "1e7e0000-0000-4000-8000-000000000603" },
  // Retaken: the earlier interview and the current one.
  retaken: {
    lead: "1ead0000-0000-4000-8000-000000000604",
    earlier: "1e7e0000-0000-4000-8000-000000000604",
    current: "1e7e0000-0000-4000-8000-000000000605",
  },
  // Slice 5: registered, no result yet.
  noResult: { lead: "1ead0000-0000-4000-8000-000000000501", interview: "1e7e0000-0000-4000-8000-000000000501" },
  // Slice 5: not registered for interview.
  noInterview: { lead: "1ead0000-0000-4000-8000-000000000502" },
}

// A number of the test's own. A leading 6 keeps it clear of the seeded
// 700 000 numbers.
function mobile() {
  return `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A lead of the test's own, interviewed with the result, and its fee Paid
// unless asked otherwise.
async function interviewedLead({
  phone = mobile(),
  whatsapp,
  result = "Passed",
  score = 78,
  paid = true,
}: { phone?: string; whatsapp?: string; result?: "Passed" | "Failed"; score?: number; paid?: boolean } = {}) {
  const studentName = `Candidate ${randomUUID().slice(0, 8)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: "Release Parent", relationship: "Mother", phone, whatsapp } },
    student: { fullName: studentName, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result, score })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  if (paid) {
    const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
    if (!marked.ok) throw new Error(`fee failed: ${marked.error}`)
  }
  return { leadId, interviewId, studentName, admissionNumber: created.data.admissionNumber }
}

async function close(leadId: string, state: "Declined" | "Inactive" | "Archived") {
  const change =
    state === "Declined"
      ? "status = 'Declined', declined_reason = 'School decision'"
      : `closure = '${state}', closure_reason = 'Duplicate record'`
  await asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [leadId]))
}

// Everything a release must leave alone: the lead, its interviews and every
// audit row about them, by count.
async function snapshot(leadId: string) {
  return inRolledBackTransaction(async (sql) => ({
    lead: (await sql.query("select * from public.leads where id = $1", [leadId])).rows[0],
    interviews: (await sql.query("select * from public.interviews where lead = $1 order by registered_at", [leadId])).rows,
    rowChanges: Number(
      (await sql.query("select count(*) from public.audit_log where lead_id = $1 and table_name is not null", [leadId])).rows[0].count,
    ),
  }))
}

async function releaseCount(interviewId: string) {
  const releases = await getResultReleases(await signedIn(MANAGER), interviewId)
  if (!releases.ok) throw new Error(releases.error)
  return releases.data.length
}

describe("the gate", () => {
  test("a lead with no interview has nothing to send", async () => {
    const view = await getResultRelease(await signedIn(ADMISSIONS), SEEDED.noInterview.lead, OFFICE)
    expect(view).toEqual({
      ok: true,
      data: { interviewId: null, blocked: "no_interview", amountOwed: null, canSend: true, offer: null, releases: [] },
    })
  })

  test("an interview with no result is refused as no_result", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, SEEDED.noResult.lead, OFFICE)).toMatchObject({
      ok: true,
      data: { interviewId: SEEDED.noResult.interview, blocked: "no_result", offer: null },
    })
    expect(await releaseResult(staff, SEEDED.noResult.interview, "whatsapp", OFFICE)).toEqual({ ok: false, error: "no_result" })
    expect(await releaseCount(SEEDED.noResult.interview)).toBe(0)
  })

  test("a result whose fee is Not Paid is refused as not_paid, with the amount owed", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, SEEDED.notPaid.lead, OFFICE)).toMatchObject({
      ok: true,
      data: { interviewId: SEEDED.notPaid.interview, blocked: "not_paid", amountOwed: 50000, offer: null },
    })
    expect(await releaseResult(staff, SEEDED.notPaid.interview, "whatsapp", OFFICE)).toEqual({ ok: false, error: "not_paid" })
    expect(await releaseCount(SEEDED.notPaid.interview)).toBe(0)
  })

  test("after a retake only the current interview's result may be sent", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, SEEDED.retaken.lead, OFFICE)).toMatchObject({
      ok: true,
      data: { interviewId: SEEDED.retaken.current, blocked: null },
    })
    expect(await releaseResult(staff, SEEDED.retaken.earlier, "whatsapp", OFFICE)).toEqual({ ok: false, error: "not_current" })
    expect(await releaseCount(SEEDED.retaken.earlier)).toBe(0)
  })

  test.each(["Declined", "Inactive", "Archived"] as const)("a %s lead is refused as lead_closed", async (state) => {
    const { leadId, interviewId } = await interviewedLead()
    await close(leadId, state)
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, leadId, OFFICE)).toMatchObject({
      ok: true,
      data: { interviewId, blocked: "lead_closed", offer: null },
    })
    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "lead_closed" })
    expect(await releaseCount(interviewId)).toBe(0)
  })

  test("the fee moved back to Not Paid after the page was read refuses the release", async () => {
    const { leadId, interviewId } = await interviewedLead()
    const staff = await signedIn(ADMISSIONS)
    const before = await getResultRelease(staff, leadId, OFFICE)
    expect(before.ok && before.data.offer?.channel).toBe("whatsapp")

    expect((await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "not_paid")).ok).toBe(true)

    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "not_paid" })
    expect(await releaseCount(interviewId)).toBe(0)
  })

  test("an interview that doesn't exist, or a malformed id, is not-found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await releaseResult(staff, randomUUID(), "whatsapp", OFFICE)).toEqual({ ok: false, error: "not-found" })
    expect(await releaseResult(staff, "not-an-id", "whatsapp", OFFICE)).toEqual({ ok: false, error: "not-found" })
    expect(await getResultRelease(staff, randomUUID(), OFFICE)).toEqual({ ok: false, error: "not-found" })
  })
})

describe("who may send", () => {
  test("the Accountant sees whether and when it was sent, with nothing to send, and is refused as forbidden", async () => {
    const { leadId, interviewId } = await interviewedLead()
    expect((await releaseResult(await signedIn(ADMISSIONS), interviewId, "whatsapp", OFFICE)).ok).toBe(true)

    const accountant = await signedIn(ACCOUNTANT)
    const view = await getResultRelease(accountant, leadId, OFFICE)
    expect(view).toMatchObject({
      ok: true,
      data: { interviewId, blocked: null, canSend: false, offer: null, releases: [{ channel: "whatsapp", releasedBy: ADMISSIONS.name }] },
    })
    // Nothing of the message or the numbers reaches a caller who can't send.
    expect(JSON.stringify(view)).not.toMatch(/Assalaam|\+255/)

    expect(await releaseResult(accountant, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "forbidden" })
    expect(await releaseCount(interviewId)).toBe(1)
  })

  test("a deactivated staff member is refused everything", async () => {
    const deactivated = await signedIn(DEACTIVATED)
    expect(await getResultRelease(deactivated, SEEDED.whatsapp.lead, OFFICE)).toEqual({ ok: false, error: "forbidden" })
    expect(await releaseResult(deactivated, SEEDED.whatsapp.interview, "whatsapp", OFFICE)).toEqual({ ok: false, error: "forbidden" })
    expect(await getResultReleases(deactivated, SEEDED.whatsapp.interview)).toEqual({ ok: false, error: "forbidden" })
    expect(await releaseCount(SEEDED.whatsapp.interview)).toBe(0)
  })

  test("a visitor who is not signed in sees nothing and sends nothing", async () => {
    const anon = anonClient()
    expect(await getResultRelease(anon, SEEDED.whatsapp.lead, OFFICE)).toEqual({ ok: false, error: "forbidden" })
    expect(await releaseResult(anon, SEEDED.whatsapp.interview, "whatsapp", OFFICE)).toEqual({ ok: false, error: "forbidden" })
    expect(await getResultReleases(anon, SEEDED.whatsapp.interview)).toEqual({ ok: false, error: "forbidden" })

    const granted = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ fn: string; anon: boolean; authenticated: boolean }>(
          `select f as fn, has_function_privilege('anon', f, 'execute') as anon,
                  has_function_privilege('authenticated', f, 'execute') as authenticated
           from unnest(array['public.release_result(uuid, text)', 'public.result_releases(uuid)',
                             'public.result_release_state(uuid)', 'public.result_release_channel(uuid)',
                             'public.result_message_fits(text, text)']) f`,
        )
      ).rows,
    )
    expect(granted).toEqual([
      { fn: "public.release_result(uuid, text)", anon: false, authenticated: true },
      { fn: "public.result_releases(uuid)", anon: false, authenticated: true },
      { fn: "public.result_release_state(uuid)", anon: false, authenticated: true },
      { fn: "public.result_release_channel(uuid)", anon: false, authenticated: false },
      { fn: "public.result_message_fits(text, text)", anon: false, authenticated: false },
    ])
  })
})

describe("the message and the channel", () => {
  test("staff who may send see the prepared WhatsApp message, addressed to the separate WhatsApp number", async () => {
    const view = await getResultRelease(await signedIn(ADMISSIONS), SEEDED.whatsapp.lead, OFFICE)
    const expected = renderResultMessage({
      channel: "whatsapp",
      result: "passed",
      parentName: "Mwanaisha Matokeo",
      studentName: "Imani Matokeo",
      score: 82,
      admissionNumber: "ADMSN-90601",
      className: "FORM 1",
      enrollmentYear: 2028,
      officePhone: OFFICE.officePhone,
    })
    expect(expected.ok).toBe(true)
    expect(view).toMatchObject({
      ok: true,
      data: {
        interviewId: SEEDED.whatsapp.interview,
        blocked: null,
        canSend: true,
        offer: { channel: "whatsapp", whatsappPhone: "+255700000602", directPhone: "+255700000601" },
        releases: [],
      },
    })
    expect(view.ok && view.data.offer?.whatsappMessage).toBe(expected.ok && expected.data.text)
  })

  test("a Failed result's message gives the office phone, addressed to the direct phone when there is no WhatsApp number", async () => {
    const view = await getResultRelease(await signedIn(MANAGER), SEEDED.directOnly.lead, OFFICE)
    expect(view).toMatchObject({ ok: true, data: { offer: { channel: "whatsapp", whatsappPhone: "+255700000603" } } })
    const message = view.ok ? view.data.offer?.whatsappMessage : null
    expect(message).toContain("Assalaam Alaykum Bakari Matokeo,")
    expect(message).toContain("*Alama:* 45%")
    expect(message).toContain("+255 673 526 644")
    expect(message).not.toContain("STD 3")
  })

  test("a release uses the WhatsApp number over the direct phone", async () => {
    const whatsapp = `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
    const { interviewId, studentName } = await interviewedLead({ whatsapp })
    const released = await releaseResult(await signedIn(ADMISSIONS), interviewId, "whatsapp", OFFICE)
    if (!released.ok || released.data.channel !== "whatsapp") throw new Error(`release failed: ${JSON.stringify(released)}`)
    expect(released.data.link.startsWith(`https://wa.me/255${whatsapp.slice(1)}?text=`)).toBe(true)
    expect(decodeURIComponent(released.data.link.split("?text=")[1])).toBe(released.data.text)
    expect(released.data.text).toContain(`*${studentName}*`)

    expect(await getResultReleases(await signedIn(ADMISSIONS), interviewId)).toMatchObject({
      ok: true,
      data: [{ channel: "whatsapp", numberUsed: "whatsapp" }],
    })
  })

  test("a release uses the direct phone when there is no WhatsApp number", async () => {
    const phone = mobile()
    const { interviewId } = await interviewedLead({ phone, result: "Failed", score: 40.5 })
    const released = await releaseResult(await signedIn(MANAGER), interviewId, "whatsapp", OFFICE)
    expect(released.ok && released.data.channel === "whatsapp" && released.data.link).toMatch(
      new RegExp(`^https://wa\\.me/255${phone.slice(1)}\\?text=`),
    )
    expect(released.ok && released.data.text).toContain("*Alama:* 40.5%")
    const releases = await getResultReleases(await signedIn(MANAGER), interviewId)
    expect(releases).toMatchObject({ ok: true, data: [{ channel: "whatsapp", numberUsed: "direct", result: "Failed", score: 40.5 }] })
  })

  test("WhatsApp is refused as no_whatsapp_number when no number is a Tanzanian mobile", async () => {
    const { leadId, interviewId } = await interviewedLead({ phone: "+447700900123" })
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, leadId, OFFICE)).toMatchObject({
      ok: true,
      data: { blocked: null, offer: { channel: "sms", whatsappPhone: null, whatsappMessage: null, directPhone: "+447700900123" } },
    })
    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "no_whatsapp_number" })
    expect(await releaseCount(interviewId)).toBe(0)
  })
})

describe("the message length", () => {
  async function renamed(parentName: string, studentName: string) {
    const lead = await interviewedLead()
    await asSystem(async (sql) => {
      await sql.query("update public.leads set student_name = $2 where id = $1", [lead.leadId, studentName])
      await sql.query(
        "update public.guardian_contacts set full_name = $2 where id = (select guardian_contact_id from public.leads where id = $1)",
        [lead.leadId, parentName],
      )
    })
    return lead
  }

  test("100-character names still go by WhatsApp", async () => {
    const { leadId, interviewId } = await renamed("P".repeat(100), `S${randomUUID().slice(0, 8)}`.padEnd(100, "s"))
    const staff = await signedIn(ADMISSIONS)
    const view = await getResultRelease(staff, leadId, OFFICE)
    expect(view.ok && view.data.offer?.whatsappMessage?.length).toBeLessThanOrEqual(1000)
    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toMatchObject({ ok: true, data: { channel: "whatsapp" } })
  })

  test("names that would take the WhatsApp message past 1,000 characters are refused as too_long before anything is recorded", async () => {
    const { leadId, interviewId } = await renamed("P".repeat(600), `Candidate ${randomUUID().slice(0, 8)}`)
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, leadId, OFFICE)).toMatchObject({
      ok: true,
      data: { blocked: null, offer: { channel: "whatsapp", whatsappMessage: null } },
    })
    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "too_long" })
    expect(await releaseCount(interviewId)).toBe(0)
  })

  test("the preview never offers a message the release would refuse", async () => {
    // Close to the bound: within 1,000 characters once rendered, but past the
    // conservative check, so neither the preview nor the release offers it.
    const { leadId, interviewId } = await renamed("P".repeat(250), `S${randomUUID().slice(0, 8)}`.padEnd(110, "s"))
    const staff = await signedIn(ADMISSIONS)
    expect(await getResultRelease(staff, leadId, OFFICE)).toMatchObject({
      ok: true,
      data: { offer: { channel: "whatsapp", whatsappMessage: null } },
    })
    expect(await releaseResult(staff, interviewId, "whatsapp", OFFICE)).toEqual({ ok: false, error: "too_long" })
  })
})

describe("the record", () => {
  test("the lead's history shows who sent it, by which channel, the result, score and template, and no phone number", async () => {
    const phone = mobile()
    const whatsapp = `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
    const { leadId, interviewId } = await interviewedLead({ phone, whatsapp, result: "Passed", score: 66.5 })
    expect((await releaseResult(await signedIn(ADMISSIONS), interviewId, "whatsapp", OFFICE)).ok).toBe(true)

    const history = await getLeadHistory(await signedIn(ACCOUNTANT), leadId)
    if (!history.ok) throw new Error(history.error)
    const entry = history.data.entries.find((e) => e.action === "result_released")
    expect(entry).toMatchObject({ actor: ADMISSIONS.name, record: null })
    expect(Object.fromEntries(entry!.changes.map((c) => [c.field, c.to]))).toEqual({
      interview_id: interviewId,
      serial_number: expect.any(Number),
      channel: "whatsapp",
      number_used: "whatsapp",
      result: "Passed",
      score: 66.5,
      template_id: "whatsapp_passed_v1",
    })
    const recorded = JSON.stringify(entry)
    expect(recorded).not.toContain(phone.slice(1))
    expect(recorded).not.toContain(whatsapp.slice(1))
  })

  test("a release changes nothing about the lead, its interview or its fee", async () => {
    const { leadId, interviewId } = await interviewedLead()
    const before = await snapshot(leadId)
    expect((await releaseResult(await signedIn(ADMISSIONS), interviewId, "whatsapp", OFFICE)).ok).toBe(true)
    expect(await snapshot(leadId)).toEqual(before)
    expect(await releaseCount(interviewId)).toBe(1)
  })

  test("the release shows on the lead's section, newest first", async () => {
    const { leadId, interviewId } = await interviewedLead()
    expect((await releaseResult(await signedIn(ADMISSIONS), interviewId, "whatsapp", OFFICE)).ok).toBe(true)
    expect((await releaseResult(await signedIn(MANAGER), interviewId, "whatsapp", OFFICE)).ok).toBe(true)
    const view = await getResultRelease(await signedIn(ADMISSIONS), leadId, OFFICE)
    expect(view).toMatchObject({
      ok: true,
      data: {
        releases: [
          { releasedBy: MANAGER.name, channel: "whatsapp", result: "Passed", score: 78, templateId: "whatsapp_passed_v1" },
          { releasedBy: ADMISSIONS.name, channel: "whatsapp" },
        ],
      },
    })
  })
})
