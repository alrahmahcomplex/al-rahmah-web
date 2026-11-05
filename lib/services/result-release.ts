import type { SupabaseClient } from "@supabase/supabase-js"

import {
  renderResultMessage,
  type InterviewResult,
  type ResultChannel,
  type ResultMessageInput,
} from "@/lib/result-messages"
import { buildWhatsAppLink } from "@/lib/whatsapp"

import type { InterviewResult as InterviewOutcome } from "./interviews"
import type { LeadClass } from "./leads"
import type { Result } from "./result"

// The result-release module (slice 6, #31): what the lead screen's Result
// release section shows, and releasing a result. The gate and the record are
// one database function, release_result, so these calls only translate what
// the database answers and build the message from the values it checked.
//
// The office phone goes in as a value (OFFICE_PHONE from lib/office.ts, which
// is server-only), so this module also runs in the database tests.

// Why the current result can't be sent now.
export type ReleaseBlocker = "no_interview" | "lead_closed" | "no_result" | "not_paid"

// One release of an interview's result, as the history records it: when, by
// whom, by which channel and to which of the contact's numbers, and the
// result and score it carried.
export type ResultReleaseRecord = {
  releasedAt: string
  // The staff member's name, looked up when read.
  releasedBy: string
  channel: ResultChannel
  numberUsed: "whatsapp" | "direct"
  result: "Passed" | "Failed"
  score: number
  templateId: string
}

// What can be sent, for a caller holding results.send.
export type ReleaseOffer = {
  // WhatsApp when one of the contact's numbers is a Tanzanian mobile.
  channel: ResultChannel
  // The number a WhatsApp link would open, when WhatsApp is offered.
  whatsappPhone: string | null
  // The direct phone, for SMS.
  directPhone: string
  // The WhatsApp message, when WhatsApp is offered. Null when the names could
  // take it past the length budget, which release_result refuses as too_long.
  whatsappMessage: string | null
  smsMessage: { text: string; gsm7: boolean; segments: number }
}

export type ResultReleaseView = {
  // The lead's current interview, if it has one.
  interviewId: string | null
  blocked: ReleaseBlocker | null
  // What the family owes, while the fee is Not Paid.
  amountOwed: number | null
  // Whether the caller holds results.send.
  canSend: boolean
  // Present only when the result can go now and the caller may send it.
  offer: ReleaseOffer | null
  // The current interview's releases, newest first.
  releases: ResultReleaseRecord[]
  // Whether the interview's result or score differs from what the last
  // release carried, so staff know to send the corrected result. Known only
  // with an offer: false while the result can't go or the caller can't send.
  changedSinceSent: boolean
}

type CommonError = "forbidden" | "not-found" | "unavailable"

type MessageValues = {
  result: "Passed" | "Failed"
  score: number | string
  parent_name: string
  student_name: string
  admission_number: string
  class_name: LeadClass
  enrollment_year: number
}

type StateRow = Partial<MessageValues> & {
  interview_id: string | null
  blocked: ReleaseBlocker | null
  amount_owed: number | null
  can_send: boolean
  channel?: ResultChannel
  whatsapp_phone?: string | null
  // Whether the names keep the WhatsApp message within its length budget, as
  // release_result will judge it.
  whatsapp_fits?: boolean
  direct_phone?: string
  // From interview_release_status, in the same read as the result and score.
  changed_since_sent?: boolean
}

type ReleaseRow = {
  released_at: string
  released_by: string | null
  channel: ResultChannel
  number_used: "whatsapp" | "direct"
  result: "Passed" | "Failed"
  score: number | string
  template_id: string
}

function commonError(error: { message: string; code?: string }): CommonError | null {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "forbidden" || error.code === "42501") return "forbidden"
  // A malformed id is a missing record, not an outage.
  if (error.message === "not-found" || error.code === "22P02") return "not-found"
  return null
}

function messageInput(values: MessageValues, channel: ResultChannel, officePhone: string): ResultMessageInput {
  return {
    channel,
    result: values.result.toLowerCase() as InterviewResult,
    parentName: values.parent_name,
    studentName: values.student_name,
    score: Number(values.score),
    admissionNumber: values.admission_number,
    className: values.class_name,
    enrollmentYear: values.enrollment_year,
    officePhone,
  }
}

// An interview's releases, newest first. Needs leads.view.
export async function getResultReleases(
  supabase: SupabaseClient,
  interviewId: string,
): Promise<Result<ResultReleaseRecord[], CommonError>> {
  const { data, error } = await supabase.rpc("result_releases", { interview_id: interviewId })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    console.error("Could not read an interview's result releases", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as ReleaseRow[]).map((row) => ({
      releasedAt: row.released_at,
      releasedBy: row.released_by ?? "A former staff member",
      channel: row.channel,
      numberUsed: row.number_used,
      result: row.result,
      score: Number(row.score),
      templateId: row.template_id,
    })),
  }
}

async function readReleaseState(supabase: SupabaseClient, leadId: string): Promise<Result<StateRow, CommonError>> {
  const { data, error } = await supabase.rpc("result_release_state", { lead_id: leadId })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    console.error("Could not read a lead's result release", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: data as StateRow }
}

// The Result release section for a lead: whether its current result can be
// sent now or why not, its releases, and, for a caller holding results.send
// when it can go, the channel and the prepared messages. Records nothing.
// Needs leads.view.
export async function getResultRelease(
  supabase: SupabaseClient,
  leadId: string,
  { officePhone }: { officePhone: string },
): Promise<Result<ResultReleaseView, CommonError>> {
  const first = await readReleaseState(supabase, leadId)
  if (!first.ok) return first
  let row = first.data
  let releases: ResultReleaseRecord[] = []
  if (row.interview_id) {
    const read = await getResultReleases(supabase, row.interview_id)
    if (!read.ok) return read
    releases = read.data
  }

  // Once there are releases, the state is read again, so the changed-since-
  // sent answer is never older than them: a correction sent between the two
  // reads is no warning. A send recorded after the releases
  // were read leaves the page short of one, so its own send is refused as
  // sent_meanwhile. If the current interview changed between the reads, the
  // section shows the first read, as it would have a moment earlier.
  if (releases.length > 0) {
    const again = await readReleaseState(supabase, leadId)
    if (!again.ok) return again
    if (again.data.interview_id === row.interview_id) row = again.data
  }

  let offer: ReleaseOffer | null = null
  if (row.blocked === null && row.can_send && row.channel && row.direct_phone) {
    const values = row as StateRow & MessageValues
    const sms = renderResultMessage(messageInput(values, "sms", officePhone))
    const whatsapp =
      row.channel === "whatsapp" && row.whatsapp_fits ? renderResultMessage(messageInput(values, "whatsapp", officePhone)) : null
    if (!sms.ok || sms.data.channel !== "sms") {
      console.error("Could not prepare a result message")
      return { ok: false, error: "unavailable" }
    }
    offer = {
      channel: row.channel,
      whatsappPhone: row.whatsapp_phone ?? null,
      directPhone: row.direct_phone,
      whatsappMessage: whatsapp?.ok ? whatsapp.data.text : null,
      smsMessage: { text: sms.data.text, gsm7: sms.data.gsm7, segments: sms.data.segments },
    }
  }

  // The database compares the last release with the interview's result and
  // score (interview_release_status), in the same read the offer's message
  // was built from, so the lead screen and the Interviews screen apply one
  // rule.
  const changedSinceSent = offer !== null && releases.length > 0 && row.changed_since_sent === true

  return {
    ok: true,
    data: {
      interviewId: row.interview_id,
      blocked: row.blocked,
      amountOwed: row.amount_owed,
      canSend: row.can_send,
      offer,
      releases,
      changedSinceSent,
    },
  }
}

// Where an interview's result stands with the family, for the Interviews
// screen.
export type ReleaseStatus = {
  // The result and score now, read with the rest, so the screen shows the
  // values the release was compared with.
  result: InterviewOutcome | null
  score: number | null
  // When its result was last sent, or null if never.
  lastReleasedAt: string | null
  // Whether its result or score differs from what the last release carried.
  // Such a result counts as not sent.
  changedSinceSent: boolean
  // Whether it is its lead's newest registration, the only one that can be sent.
  current: boolean
  // Current, the lead open, a result recorded, the fee Paid, and not sent or
  // changed since: what release_result would accept now.
  readyToSend: boolean
}

type StatusRow = {
  interview_id: string
  is_current: boolean
  result: InterviewOutcome | null
  score: number | string | null
  last_released_at: string | null
  changed_since_sent: boolean
  ready_to_send: boolean
}

// The release status of each of these interviews, by id, read at one moment.
// Ids that match no interview are left out. Needs leads.view.
export async function listReleaseStatus(
  supabase: SupabaseClient,
  interviewIds: readonly string[],
): Promise<Result<Map<string, ReleaseStatus>, CommonError>> {
  if (interviewIds.length === 0) return { ok: true, data: new Map() }
  const { data, error } = await supabase.rpc("interview_release_status", { interview_ids: interviewIds })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    console.error("Could not read the interviews' release status", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: new Map(
      ((data ?? []) as StatusRow[]).map((row) => [
        row.interview_id,
        {
          result: row.result,
          score: row.score === null ? null : Number(row.score),
          lastReleasedAt: row.last_released_at,
          changedSinceSent: row.changed_since_sent,
          current: row.is_current,
          readyToSend: row.ready_to_send,
        },
      ]),
    ),
  }
}

export type ReleaseError =
  | CommonError
  | "lead_closed"
  | "not_current"
  | "no_result"
  | "not_paid"
  | "no_whatsapp_number"
  // The names would take the WhatsApp message past its length budget.
  | "too_long"
  // The interview has more releases than the sending page saw.
  | "sent_meanwhile"

const RELEASE_REFUSALS: ReadonlySet<string> = new Set<ReleaseError>([
  "lead_closed",
  "not_current",
  "no_result",
  "not_paid",
  "no_whatsapp_number",
  "too_long",
])

export type ReleasedResult =
  | { channel: "whatsapp"; text: string; link: string }
  | { channel: "sms"; text: string; phone: string; gsm7: boolean; segments: number }

// Releases the interview's result by the channel, recording who sent it,
// when, how, and the result and score. Returns the message built from the
// values the database checked, and for WhatsApp the wa.me link that opens the
// chat with it typed in. Needs results.send.
//
// seenReleases is how many releases the sending page showed. When the
// interview has more, someone sent it since the page loaded, and the send is
// refused as sent_meanwhile, recording nothing, so a page that never showed
// the repeat-send confirmation can't send twice. The count is read just
// before the release, so two sends in the same instant can both pass.
export async function releaseResult(
  supabase: SupabaseClient,
  interviewId: string,
  channel: ResultChannel,
  { officePhone, seenReleases }: { officePhone: string; seenReleases?: number },
): Promise<Result<ReleasedResult, ReleaseError>> {
  if (seenReleases !== undefined) {
    const releases = await getResultReleases(supabase, interviewId)
    if (!releases.ok) return releases
    if (releases.data.length > seenReleases) return { ok: false, error: "sent_meanwhile" }
  }

  const { data, error } = await supabase.rpc("release_result", { interview_id: interviewId, channel })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    if (RELEASE_REFUSALS.has(error.message)) return { ok: false, error: error.message as ReleaseError }
    // Never the message: the database has not built one.
    console.error("Could not release an interview result", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as MessageValues & { channel: ResultChannel; phone: string }
  const rendered = renderResultMessage(messageInput(row, row.channel, officePhone))
  if (!rendered.ok) {
    console.error("A released result message could not be prepared")
    return { ok: false, error: "unavailable" }
  }

  if (rendered.data.channel === "sms") {
    const { text, gsm7, segments } = rendered.data
    return { ok: true, data: { channel: "sms", text, phone: row.phone, gsm7, segments } }
  }

  // The database offered WhatsApp only to a Tanzanian mobile; the link takes
  // it without its `+`.
  const link = buildWhatsAppLink(rendered.data.text, row.phone.replace(/^\+/, ""))
  if (!link.ok) {
    console.error("A released result's WhatsApp number could not be linked")
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { channel: "whatsapp", text: rendered.data.text, link: link.data } }
}
