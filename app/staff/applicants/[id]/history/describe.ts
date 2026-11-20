import { formatDate } from "@/lib/school-calendar"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { PAYMENT_TYPE_NAMES, type RecordedPaymentType } from "@/lib/services/school-fee-payments"

import {
  ADJUSTMENT_HIDDEN,
  adjustmentLabel,
  adjustmentSummary,
  adjustmentValue,
  isPriorityChange,
  PRIORITY_CHANGE_HIDDEN,
} from "./adjustment-history"
import { isBecause, rowCauses, withCause } from "./because"
import {
  DISCOUNT_HIDDEN,
  discountKinds,
  discountLabel,
  discountSummary,
  discountValue,
  withoutAppliedReason,
  type DiscountKinds,
} from "./discount-history"
import {
  ENROLMENT_FIELDS,
  ENROLMENT_HIDDEN,
  enrolmentCauses,
  enrolmentLabel,
  enrolmentProfileSummary,
  enrolmentSummary,
  enrolmentValue,
  type EnrolmentCauses,
} from "./enrolment-history"
import {
  GROUP_INVITATION_HIDDEN,
  groupInvitationLabel,
  groupInvitationSummary,
  groupInvitationValue,
} from "./group-invitation-history"
import { IMPORT_HIDDEN, IMPORT_LABELS, importNote } from "./import-history"
import { interviewSerials, withInterviewSerial } from "./interview-history"
import { REOPENING_HIDDEN, reopenedLeadSummary, reopeningLabel, reopeningSummary, reopeningValue } from "./reopening-history"
import {
  isResultRelease,
  RESULT_RELEASE_HIDDEN,
  resultReleaseLabel,
  resultReleaseSummary,
  resultReleaseValue,
} from "./result-release-history"
import {
  collapseSeatSaves,
  seatHidden,
  seatKeepsEmpty,
  seatLabel,
  seatOrder,
  seatSummary,
  seatValue,
  streamOpenings,
  unprovenOpening,
  type StreamOpenings,
} from "./seat-history"
import {
  collapseGroupSaves,
  siblingChoices,
  siblingHidden,
  siblingLabel,
  siblingOfValue,
  siblingOrder,
  siblingSummary,
  siblingValue,
  withEditResult,
  type SiblingChoices,
} from "./sibling-history"

// A lead's history entry in plain words: who, what they did, and each field's
// old and new value. A field, table or action kind this file does not know
// shows under its raw name with its raw value (ADR 4), so an entry a later
// slice writes reads before anyone adds a label for it.

// `from` is null on a creation, which has no old value.
export type DescribedChange = { label: string; from: string | null; to: string }

export type DescribedEntry = {
  id: number
  at: string
  actor: string
  summary: string
  changes: DescribedChange[]
  // A line under the summary, such as the import a lead came from.
  note?: string
}

const LABELS: Record<string, string> = {
  // The lead.
  admission_number: "Admission Number",
  student_name: "Student name",
  class_name: "Class",
  enrollment_year: "Enrollment year",
  day_or_boarding: "Day or boarding",
  status: "Status",
  closure: "Closure",
  declined_reason: "Declined reason",
  declined_explanation: "Decline explanation",
  status_before_decline: "Status before decline",
  closure_reason: "Closure reason",
  closure_note: "Closure note",
  initially_declined: "Initially declined",
  visit_date: "Visit date",
  guardian_contact_id: "Parent or guardian",
  returning_family_joined: "Returning family: joined a Family",
  returning_family_reapplied: "Returning family: re-applied",
  referral_code: "Referral code",
  referral_notice_version: "Code holder notice",
  // The father's full name and where it came from (#299), and the custodian,
  // who brought the child and the previous school (#298), labelled in #310.
  father_full_name: "Father’s full name",
  father_full_name_source: "Father’s name from",
  custodian_relationship: "Custodian’s relationship",
  custodian_relationship_description: "Custodian’s relationship details",
  brought_by_name: "Brought by",
  brought_by_phone: "Brought by: phone",
  brought_by_relationship: "Brought by: relationship",
  previous_school_name: "Previous school",
  previous_school_type: "Previous school: private or public",
  previous_school_region: "Previous school: region",
  previous_school_not_known: "Previous school not known yet",
  // Asked at check-in (#309), and used to place the child in a stream (#449).
  gender: "Boy or girl",
  // Its parent or guardian.
  full_name: "Full name",
  contact_name: "Parent or guardian name",
  relationship: "Relationship",
  relationship_description: "Relationship details",
  phone: "Phone",
  whatsapp: "WhatsApp",
  origin: "Added from",
  pending_family_match_id: "Unconfirmed Family match",
  // Its interviews.
  serial_number: "S/N",
  serial_year: "S/N enrollment year",
  interview_date: "Interview date",
  result: "Interview result",
  score: "Interview score",
  fee_status: "Interview fee",
  locked_amount: "Amount paid",
  locked_discount_applied: "Referral code discount",
  // Its follow-ups.
  due_on: "Follow-up date",
  note: "Note",
  change_reason: "Reason for the change",
  // Its school-fee payments, shown only to staff who may view payments.
  payment_type: "Payment type",
  amount: "Amount",
  paid_on: "Payment date",
  // Its re-applications, which also use the lead's and contact's labels.
  discount_code: "Discount code",
  differing_fields: "Differs from the application",
  // A Marketing Agent. Agent rows carry no lead id, so they show in no lead's
  // history; these label them wherever the history is read.
  code: "Referral code",
  registered_at: "Registered",
  approved_at: "Approved at",
  approved_by: "Approved by",
  // Its follow-up records.
  method: "Contact method",
  contacted_by: "Made the contact",
  contacted_at: "Contacted at",
  comment: "Comment",
  outcome: "Outcome",
  cause: "Closed with the application",
  // A lead the student import created.
  ...IMPORT_LABELS,
}

// Kept on a row for the database's sake, and already shown by the entry
// itself: who declined a lead and when; an interview's lead, and who
// registered it when.
const HIDDEN: Record<string, ReadonlySet<string>> = {
  // Read by nothing since each child holds the custodian’s relationship (#312).
  lead: new Set(["declined_at", "declined_by", "closed_at", "closed_by", "custodian_relationship_own", IMPORT_HIDDEN]),
  interviews: new Set(["lead", "registered_at", "registered_by", IMPORT_HIDDEN]),
  // The follow-up a date change replaced shows as the earlier date instead.
  follow_ups: new Set(["lead_id", "replaces_id", "replaced_due_on"]),
  reopening_requests: REOPENING_HIDDEN,
  discount_requests: DISCOUNT_HIDDEN,
  lead_fee_profiles: ENROLMENT_HIDDEN,
  // The entry already says who recorded the payment, and when. The request id
  // only stops a retried Confirm recording it twice.
  school_fee_payments: new Set(["lead_id", "recorded_by", "recorded_at", "request_id"]),
  payment_adjustments: ADJUSTMENT_HIDDEN,
  // The numbers as typed show as stored instead. The entry itself says who
  // reviewed it, and when.
  re_applications: new Set([
    "lead_id",
    "submission_key",
    "received_at",
    "phone_as_sent",
    "whatsapp_as_sent",
    "reviewed_at",
    "reviewed_by",
    // Kept for staff since #400; shown once #421 decides how.
    "father_full_name",
  ]),
  // A record's follow-ups show as their own entries; its kind and entry time
  // show in the entry itself.
  follow_up_records: new Set(["lead_id", "follow_up_id", "next_follow_up_id", "kind", "entered_at"]),
  whatsapp_group_invitations: GROUP_INVITATION_HIDDEN,
}

const OUTCOMES: Record<string, string> = {
  next_date: "Next follow-up planned",
  lead_enrolled: "No next date: the student is Enrolled",
  lead_declined: "The family will not proceed: application declined",
}

// Why a follow-up closed with its lead, as the Follow-ups panel says it.
const CAUSES: Record<string, string> = {
  declined: "Declined",
  inactive: "Inactive",
  archived: "Archived",
}

const CONTACT_TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Dar_es_Salaam" })

// Which code-holder notice went with a Referral code (#182). form_v1 is the
// one-child wording used until #282; form_v2 covers every student on the form.
const NOTICE_VERSIONS: Record<string, string> = {
  form_v1: "Shown on the Admission form (form_v1)",
  form_v2: "Shown on the Admission form (form_v2)",
  staff_reminder: "Staff reminded to tell the family",
}

// Where a father's full name came from (#299).
const FATHER_SOURCES: Record<string, string> = {
  derived: "From the student’s name",
  backfilled: "From the student’s name, when sibling groups began",
  edited: "Corrected by staff",
  typo_confirmed: "Typing mistake confirmed",
}

const SCHOOL_TYPES: Record<string, string> = { private: "Private", public: "Public" }

const ORIGINS: Record<string, string> = {
  front_desk: "Front desk",
  admission_form: "Admission form",
}

function raw(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return JSON.stringify(value)
}

function display(field: string, value: unknown, contactNames: Readonly<Record<string, string>>): string {
  if (value === null || value === undefined) return field === "whatsapp" ? "Same as phone" : "None"
  switch (field) {
    case "visit_date":
    case "interview_date":
    case "due_on":
    case "paid_on":
      return typeof value === "string" ? formatDate(value) : raw(value)
    case "guardian_contact_id":
    case "pending_family_match_id":
      return contactNames[String(value)] ?? raw(value)
    case "origin":
      return ORIGINS[String(value)] ?? raw(value)
    case "father_full_name_source":
      return FATHER_SOURCES[String(value)] ?? raw(value)
    case "previous_school_type":
      return SCHOOL_TYPES[String(value)] ?? raw(value)
    case "referral_notice_version":
      return NOTICE_VERSIONS[String(value)] ?? raw(value)
    case "score":
      return typeof value === "number" ? `${value}%` : raw(value)
    case "locked_amount":
      return typeof value === "number" ? `TZS ${value.toLocaleString("en-US")}` : raw(value)
    case "payment_type":
      return PAYMENT_TYPE_NAMES[value as RecordedPaymentType] ?? raw(value)
    case "amount":
      return typeof value === "number" ? `TZS ${value.toLocaleString("en-US")}` : raw(value)
    case "differing_fields":
      if (!Array.isArray(value)) return raw(value)
      return value.length === 0 ? "Nothing" : value.map((f) => LABELS[String(f)] ?? String(f)).join(", ")
    // The staff member who made a contact, by name: the history page adds
    // their names to the contacts' names.
    case "contacted_by":
      return contactNames[String(value)] ?? raw(value)
    case "contacted_at":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? CONTACT_TIME.format(new Date(value)) : raw(value)
    case "outcome":
      return OUTCOMES[String(value)] ?? raw(value)
    case "cause":
      return CAUSES[String(value)] ?? raw(value)
    default:
      return raw(value)
  }
}

// A creation lists what the new row holds; empty fields and unset flags say
// nothing there.
function isEmpty(value: unknown) {
  return value === null || value === undefined || value === false
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

// Each contact's unconfirmed Family match over time, from the contact's own
// entries in the history, oldest first. Audit ids only grow, so an entry's id
// places it in that sequence.
type MatchTimeline = ReadonlyMap<string, readonly { id: number; match: unknown }[]>

function matchTimeline(entries: readonly LeadHistoryEntry[]): MatchTimeline {
  const timeline = new Map<string, { id: number; match: unknown }[]>()
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.record !== "contact" || !entry.recordId) continue
    const match = entry.changes.find((c) => c.field === "pending_family_match_id")
    if (!match) continue
    timeline.set(entry.recordId, [...(timeline.get(entry.recordId) ?? []), { id: entry.id, match: match.to }])
  }
  return timeline
}

// The contact's unconfirmed match as it stood just before the given entry.
function matchBefore(timeline: MatchTimeline, contactId: unknown, entryId: number): unknown {
  if (typeof contactId !== "string") return null
  const earlier = (timeline.get(contactId) ?? []).filter((step) => step.id < entryId)
  return earlier[earlier.length - 1]?.match ?? null
}

// Every contact the given contact was ever matched to, unconfirmed.
function everMatchedTo(timeline: MatchTimeline, contactId: unknown): unknown[] {
  if (typeof contactId !== "string") return []
  return (timeline.get(contactId) ?? []).map((step) => step.match).filter((match) => match !== null)
}

function summarize(
  entry: LeadHistoryEntry,
  contactNames: Readonly<Record<string, string>>,
  timeline: MatchTimeline,
  causes: EnrolmentCauses,
  context: Context,
): string {
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  const insert = entry.action === "insert"

  if (entry.record === "lead") {
    if (insert) {
      if (changed.get("returning_family_joined")?.to !== true) return "created the application"
      // The Admission form joins a Family only unconfirmed: the child's
      // contact carries a match that staff have yet to confirm.
      const unconfirmed = matchBefore(timeline, changed.get("guardian_contact_id")?.to, entry.id) !== null
      return unconfirmed ? "created the application, matched to a known Family but not yet confirmed" : "created the application and joined a Family"
    }
    if (entry.action !== "update") return entry.action

    const status = changed.get("status")
    const reopened = reopenedLeadSummary(changed)
    if (reopened) return reopened
    if (status?.from === "Applied" && status.to === "Visited") return "recorded a visit"
    // The first interview result moves the lead on.
    if (status?.from === "Visited" && status.to === "Interviewed") return "moved the applicant to Interviewed"
    const enrolment = enrolmentSummary(entry, status, causes)
    if (enrolment) return enrolment
    // Confirming moves the lead onto the contact its own contact was matched
    // to. Any other move is a separation onto a copy of the contact.
    // Rejecting clears the Family cause and keeps the contact.
    const contact = changed.get("guardian_contact_id")
    if (contact) {
      return everMatchedTo(timeline, contact.from).includes(contact.to) ? "confirmed the Family match" : "separated the applicant from their Family"
    }
    if (changed.get("returning_family_joined")?.to === false) return "rejected the Family match"
    if (changed.get("status")?.to === "Declined") return "declined the application"
    const closure = changed.get("closure")
    if (closure?.to === "Inactive") return "marked the application Inactive"
    if (closure?.to === "Archived") return closure.from === "Inactive" ? "moved the application from Inactive to Archived" : "archived the application"
    if (changed.get("returning_family_reapplied")?.to === true) return "flagged the application Returning family: re-applied"
    // The notice version changes with the code, and says nothing on its own.
    const referral = changed.get("referral_code")
    if (referral && changed.size === (changed.has("referral_notice_version") ? 2 : 1)) {
      if (referral.to === null) return "cleared the Referral code"
      return referral.from === null ? "added a Referral code" : "changed the Referral code"
    }
    return "changed the application"
  }

  if (entry.record === "contact") {
    const name = contactNames[entry.recordId ?? ""]
    const who = name ? `the parent or guardian ${name}` : "a parent or guardian"
    const match = changed.get("pending_family_match_id")
    if (insert) return match?.to ? `added ${who}, matched to a known Family but not yet confirmed` : `added ${who}`
    if (entry.action !== "update") return entry.action
    if (match && match.to === null) return name ? `closed the unconfirmed Family match of ${name}` : "closed an unconfirmed Family match"
    if (match) return `matched ${who} to a known Family, not yet confirmed`
    return `changed ${who}`
  }

  if (entry.record === "interviews") {
    if (insert) return "registered the applicant for interview"
    if (entry.action !== "update") return entry.action
    // The date, result and score are set together, so the first recording
    // sets the result where there was none, and a correction changes any of
    // the three that were already set.
    const result = changed.get("result")
    if (result && result.from === null) return "recorded the interview result"
    if (["interview_date", "result", "score"].some((field) => changed.get(field) && changed.get(field)?.from !== null)) {
      return "corrected the interview result"
    }
    // The amount paid shows as its own change: locked on Paid, released on
    // Not Paid.
    const fee = changed.get("fee_status")?.to
    if (fee === "Paid") return "marked the interview fee Paid"
    if (fee === "Not Paid") return "marked the interview fee Not Paid"
    return "changed the interview"
  }

  if (entry.record === "follow_ups") {
    if (insert) return changed.get("replaces_id")?.to ? "changed the follow-up date" : "scheduled a follow-up"
    return entry.action
  }

  if (entry.record === "reopening_requests") return reopeningSummary(entry)
  const discount = discountSummary(entry, context.kinds)
  if (discount) return discount
  const sibling = siblingSummary(entry, context.choices)
  if (sibling) return sibling
  const seat = seatSummary(entry, context.streamNames)
  if (seat) return seat
  if (entry.record === "lead_fee_profiles") return enrolmentProfileSummary(entry)
  if (entry.record === "school_fee_payments" && insert) {
    return changed.get("payment_type")?.to === "pre_form_one_fee" ? "recorded a Pre-Form One fee payment" : "recorded a school-fee payment"
  }
  const adjustment = adjustmentSummary(entry)
  if (adjustment) return adjustment
  if (entry.record === "re_applications" && insert) return "recorded a re-application"
  if (entry.record === "re_applications" && changed.get("reviewed_at")?.to) return "marked the re-application reviewed"
  if (entry.record === "follow_up_records") {
    if (!insert) return entry.action
    if (changed.get("kind")?.to === "closed_with_lead") return "closed the follow-up with the application"
    return changed.get("follow_up_id")?.to ? "recorded a follow-up" : "recorded an unplanned contact"
  }

  const invitation = groupInvitationSummary(entry)
  if (invitation) return invitation

  if (entry.record !== null) {
    if (insert) return `added ${article(entry.record)} ${entry.record} record`
    if (entry.action === "update") return `changed ${article(entry.record)} ${entry.record} record`
    return entry.action
  }

  // An action event: something done that changed no row.
  if (isResultRelease(entry)) return resultReleaseSummary(entry)
  return `recorded ${entry.action}`
}

// Known fields in the order the lead screen shows them, then unknown ones as
// they came. A sibling or seat table lists its own fields in its own order.
const ORDER = [...Object.keys(LABELS), ...ENROLMENT_FIELDS]

function rank(record: string | null, field: string) {
  const order = siblingOrder(record) ?? seatOrder(record) ?? ORDER
  const at = order.indexOf(field)
  return at === -1 ? order.length : at
}

// The siblings and streams the history points at, by id: a sibling as
// "Name · Admission Number", a stream as screens name it. When each stream
// was opened tells a stream opened to answer a request from one already there.
export type HistoryNames = {
  leads?: Readonly<Record<string, string>>
  streams?: Readonly<Record<string, string>>
  streamOpenedAt?: Readonly<Record<string, string>>
}

// What the whole history tells each entry, and the names read alongside it.
type Context = {
  kinds: DiscountKinds
  choices: SiblingChoices
  openings: StreamOpenings
  leadNames: Readonly<Record<string, string>>
  streamNames: Readonly<Record<string, string>>
}

// A whole history, in the order it came (newest first). The Family entries
// are read against the contacts' own entries, so the history is described as
// a whole.
// `importFile` names the student import the lead came from, if it did.
export function describeLeadHistory(
  entries: readonly LeadHistoryEntry[],
  contactNames: Readonly<Record<string, string>>,
  importFile: string | null = null,
  names: HistoryNames = {},
): DescribedEntry[] {
  const timeline = matchTimeline(entries)
  const plans = followUpPlans(entries)
  const causes = enrolmentCauses(entries)
  const serials = interviewSerials(entries)
  // One save that wrote a row several times reads as one entry: a sibling
  // answer with its link, and a seat released and placed again.
  const shown = collapseSeatSaves(collapseGroupSaves(entries))
  const choices = siblingChoices(shown)
  const context: Context = {
    kinds: discountKinds(entries),
    choices,
    openings: streamOpenings(entries, names.streamOpenedAt ?? {}),
    leadNames: names.leads ?? {},
    streamNames: names.streams ?? {},
  }
  const rowCause = rowCauses(entries)
  return shown.map((entry) => {
    const prepared = withCause(withoutAppliedReason(withEditResult(withEarlierPlan(entry, plans))), rowCause)
    const described = withInterviewSerial(entry, describeEntry(prepared, contactNames, timeline, causes, context), serials)
    const note = importNote(entry, importFile)
    return note ? { ...described, note } : described
  })
}

// Each follow-up's date and note as written, by follow-up id.
function followUpPlans(entries: readonly LeadHistoryEntry[]): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
  const plans = new Map<string, ReadonlyMap<string, unknown>>()
  for (const entry of entries) {
    if (entry.record !== "follow_ups" || entry.action !== "insert" || !entry.recordId) continue
    plans.set(entry.recordId, new Map(entry.changes.map((c) => [c.field, c.to])))
  }
  return plans
}

// A follow-up that replaced another reads as a change from the earlier date,
// which the replacement carries itself, so the entry reads right even when the
// earlier plan's own entry isn't in this page of history. A note carried over
// unchanged says nothing new, so it is left out when the earlier plan is here.
function withEarlierPlan(entry: LeadHistoryEntry, plans: ReturnType<typeof followUpPlans>): LeadHistoryEntry {
  if (entry.record !== "follow_ups" || entry.action !== "insert") return entry
  const replaced = entry.changes.find((c) => c.field === "replaces_id")?.to
  if (typeof replaced !== "string") return entry
  const earlier = plans.get(replaced)
  const earlierDate = entry.changes.find((c) => c.field === "replaced_due_on")?.to ?? earlier?.get("due_on") ?? null
  return {
    ...entry,
    changes: entry.changes
      .filter((c) => !(earlier && c.field === "note" && c.to === earlier.get("note")))
      .map((c) => (c.field === "due_on" ? { ...c, from: earlierDate } : c)),
  }
}

function describeEntry(
  entry: LeadHistoryEntry,
  contactNames: Readonly<Record<string, string>>,
  timeline: MatchTimeline,
  causes: EnrolmentCauses,
  context: Context,
): DescribedEntry {
  // A Seat priority change reads from the old priority, even from none.
  const fromOld = (entry.record !== null && entry.action === "update") || isPriorityChange(entry)
  // A sibling's, a Sibling request's or a stream's value, in words.
  const ownValue = (field: string, value: unknown) =>
    siblingOfValue(entry.record, field, value, context.leadNames) ??
    siblingValue(entry.record, field, value) ??
    seatValue(entry.record, field, value, context.streamNames)
  return {
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    summary: summarize(entry, contactNames, timeline, causes, context),
    changes: entry.changes
      .filter((c) => !HIDDEN[entry.record ?? ""]?.has(c.field))
      .filter((c) => !siblingHidden(entry.record, c.field) && !seatHidden(entry.record, c.field))
      .filter((c) => !unprovenOpening(entry, c.field, context.openings))
      .filter((c) => !(isPriorityChange(entry) && PRIORITY_CHANGE_HIDDEN.has(c.field)))
      .filter((c) => !(isResultRelease(entry) && RESULT_RELEASE_HIDDEN.has(c.field)))
      .filter((c) => fromOld || !isEmpty(c.to) || seatKeepsEmpty(entry, c.field))
      .sort((a, b) => rank(entry.record, a.field) - rank(entry.record, b.field))
      .map((c) => ({
        label:
          resultReleaseLabel(entry.action, c.field) ??
          groupInvitationLabel(entry.record, c.field) ??
          reopeningLabel(entry.record, c.field) ??
          discountLabel(entry.record, c.field) ??
          enrolmentLabel(entry.record, c.field) ??
          adjustmentLabel(entry, c.field) ??
          siblingLabel(entry.record, c.field) ??
          seatLabel(entry.record, c.field) ??
          LABELS[c.field] ??
          c.field,
        // A creation has no old value, except a follow-up's earlier date and a
        // fee edit's earlier result.
        from:
          (fromOld || c.from !== null) && !isBecause(entry.record, c.field)
            ? (reopeningValue(entry.record, c.field, c.from) ??
              discountValue(entry.record, c.field, c.from) ??
              enrolmentValue(entry.record, c.field, c.from) ??
              adjustmentValue(entry, c.field, c.from) ??
              ownValue(c.field, c.from) ??
              display(c.field, c.from, contactNames))
            : null,
        to:
          resultReleaseValue(entry.action, c.field, c.to) ??
          groupInvitationValue(entry.record, c.field, c.to) ??
          reopeningValue(entry.record, c.field, c.to) ??
          discountValue(entry.record, c.field, c.to) ??
          enrolmentValue(entry.record, c.field, c.to) ??
          adjustmentValue(entry, c.field, c.to) ??
          ownValue(c.field, c.to) ??
          display(c.field, c.to, contactNames),
      })),
  }
}
