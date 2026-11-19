import type { IconName } from "@/components/icons"
import type { Permission } from "@/lib/permissions"
import type { ActivityLead, ActivityRow } from "@/lib/services/home-activity"
import type { Relationship } from "@/lib/services/leads"
import type { PaymentType } from "@/lib/services/school-fee-payments"

import { agentsHref } from "../agents/search-params"
import { leadTabHref } from "../applicants/[id]/tabs"
import { checkInHref, mayCheckIn } from "../check-in/permissions"

// Home's Activity log (#406): each row as prototype v39 draws it, with its
// next step for the roles that may take it. The words are v39's, including
// its stand-ins for what the app can't do yet (no button on sibling requests,
// on fee payments, or for an Officer on any discount request).

export type ActivityAction = { label: string; href: string }

export type ActivityNote = { tone: "info" | "wait"; text: string }

export type ActivityView = {
  key: string
  /** "08:05" for something today, "Today", "All day", or a date such as "6 Nov". */
  time: string
  icon: IconName
  task: string
  /** Who, then what about, joined with " · ". */
  who: string
  about: string | null
  details: string
  action: ActivityAction | null
  /** "Admission form", a staff member's name, or nothing for rows that keep no such record. */
  recordedBy: string | null
  note: ActivityNote | null
}

export type ActivityContext = { today: string; permissions: readonly Permission[] }

const ZONE = "Africa/Dar_es_Salaam"
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const DAY_OF = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
const SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
const LONG = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" })
const MONEY = new Intl.NumberFormat("en-GB")

const dateOnly = (day: string) => new Date(`${day}T00:00:00Z`)
/** "6 Nov". */
export const shortDate = (day: string) => SHORT.format(dateOnly(day))
/** "6 November". */
export const longDate = (day: string) => LONG.format(dateOnly(day))
/** The Tanzania calendar day of an instant, YYYY-MM-DD. */
export const tanzaniaDayOf = (at: string) => DAY_OF.format(new Date(at))

/** A timestamp's place in the time column: its clock time today, its date before. */
export function timeOf(at: string, today: string): string {
  const day = tanzaniaDayOf(at)
  return day === today ? CLOCK.format(new Date(at)) : shortDate(day)
}

/** A date's place in the time column: "Today", or the date. */
export function dayOf(day: string, today: string): string {
  return day === today ? "Today" : shortDate(day)
}

const has = (context: ActivityContext, ...needed: Permission[]) => needed.every((permission) => context.permissions.includes(permission))

const PAYMENT_WORDS: Record<PaymentType, string> = {
  full_payment: "full payment",
  initial_deposit: "initial deposit",
  first_instalment: "first instalment",
  second_instalment: "second instalment",
  third_instalment: "third instalment",
}

const DISCOUNT = {
  sibling: { task: "Sibling discount request", name: "Sibling 10%" },
  staff_child: { task: "Staff child discount request", name: "Staff child 25%" },
  qualified_orphan: { task: "Qualified orphan discount request", name: "Qualified orphan 100%" },
} as const

const RELATION_WORDS: Record<Exclude<Relationship, "Other">, string> = { Mother: "mother", Father: "father", Guardian: "guardian" }

/** "Yusuf, Mariam and Ali" for any number of names. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
const percent = (score: number) => `${Number.isInteger(score) ? score : score.toFixed(1)}%`
const pageOf = (lead: ActivityLead, tab: Parameters<typeof leadTabHref>[1], anchor?: string) => leadTabHref(lead.leadId, tab, anchor)

/** One row of the log as the signed-in staff member sees it. */
export function activityView(row: ActivityRow, context: ActivityContext): ActivityView {
  const { today } = context
  switch (row.kind) {
    case "expected": {
      const first = row.children[0]
      return {
        key: `expected:${row.id}`,
        time: "All day",
        icon: "checkin",
        task: "Expected at the desk",
        who: listed(row.children.map((child) => child.studentName)),
        about: listed(row.children.map((child) => child.className)),
        details: `Sent the Admission form on ${longDate(row.sentOn)}. Check them in when they arrive.`,
        // Check-in opens for staff who may check in (#309); anyone else who records visits gets the record.
        action: !first
          ? null
          : mayCheckIn(context.permissions)
            ? { label: "Check in", href: checkInHref(first.leadId) }
            : has(context, "visits.record")
              ? { label: "Check in", href: pageOf(first, "overview") }
              : null,
        recordedBy: "Admission form",
        note: null,
      }
    }
    case "new_application": {
      const open = row.status !== "Declined" && row.closure === null
      return {
        key: `new_application:${row.id}`,
        time: timeOf(row.at, today),
        icon: "register",
        task: "New application",
        who: row.studentName,
        about: row.className,
        details: row.referralCode
          ? `Sent from the Admission form with Discount code ${row.referralCode}. Invite the family to the school.`
          : "Sent from the Admission form, no Discount code. Invite the family to the school.",
        action: open && has(context, "follow_ups.record") ? { label: "Call the family", href: pageOf(row, "follow-ups", "lead-follow-ups") } : null,
        recordedBy: "Admission form",
        note: null,
      }
    }
    case "result_ready":
      return {
        key: `result_ready:${row.id}`,
        time: dayOf(row.interviewDate, today),
        icon: "interviews",
        task: "Interview result ready",
        who: row.studentName,
        about: row.className,
        details: row.changedSinceSent
          ? `${row.result} with ${percent(row.score)}. The family has the earlier result. Send the corrected one.`
          : `${row.result} with ${percent(row.score)}. The family hasn’t been told yet.`,
        action: has(context, "results.send") ? { label: "Release the result", href: pageOf(row, "interview", "result-release") } : null,
        recordedBy: null,
        note: null,
      }
    case "discount_request": {
      const words = DISCOUNT[row.discount]
      const decides = has(context, "discounts.approve")
      return {
        key: `discount_request:${row.id}`,
        time: timeOf(row.at, today),
        icon: "discounts",
        task: words.task,
        who: row.studentName,
        about: row.className,
        details: `${words.name}: ${row.note}`,
        // Sibling requests are decided on a screen of their own, which #310 builds.
        action: decides && row.discount !== "sibling" ? { label: "Approve or refuse", href: "/staff/discounts" } : null,
        recordedBy: row.requestedBy,
        note: { tone: "wait", text: decides ? "You can approve or refuse this request." : "Only the Admissions Manager can approve this." },
      }
    }
    case "agent_claim":
      return {
        key: `agent_claim:${row.id}`,
        time: timeOf(row.at, today),
        icon: "agents",
        task: "Discount code claimed",
        who: row.fullName,
        about: row.code,
        details: "Asked to join with an existing code. Only a manager can confirm it.",
        action: has(context, "agents.approve")
          ? { label: "Confirm the code", href: agentsHref({ status: "all", account: "awaiting_confirmation", page: 1 }) }
          : null,
        recordedBy: "Discount code sign-up",
        note: null,
      }
    case "re_application":
      return {
        key: `re_application:${row.id}`,
        time: timeOf(row.at, today),
        icon: "reapps",
        task: "Re-application to review",
        who: row.studentName,
        about: row.className,
        details:
          row.differingFields.includes("class_name") && row.askedClass !== row.className
            ? `Sent the form again and asks for ${row.askedClass} instead of ${row.className}.`
            : "Sent the form again.",
        action: has(context, "leads.edit") ? { label: "Review", href: `/staff/re-applications/${row.id}` } : null,
        recordedBy: "Admission form",
        note: null,
      }
    case "fee_paid":
      return {
        key: `fee_paid:${row.id}`,
        time: timeOf(row.at, today),
        icon: "fees",
        task: "School fee paid",
        who: row.studentName,
        about: row.className,
        details: `TZS ${MONEY.format(row.amount)}, ${PAYMENT_WORDS[row.paymentType]}.`,
        action: null,
        recordedBy: row.recordedBy,
        note: null,
      }
    case "call_back": {
      const relation = row.relationship === "Other" ? (row.relationshipDescription ?? "custodian").toLowerCase() : RELATION_WORDS[row.relationship]
      const when = row.dueOn === today ? "Due today" : `Overdue since ${longDate(row.dueOn)}`
      return {
        key: `call_back:${row.id}`,
        time: dayOf(row.dueOn, today),
        icon: "followups",
        task: "Call back",
        who: row.custodianName,
        about: `${relation} of ${firstName(row.studentName)}`,
        details: row.note ? `${when}: ${row.note}` : `${when}.`,
        action: has(context, "follow_ups.record") ? { label: "Call", href: pageOf(row, "follow-ups", "lead-follow-ups") } : null,
        recordedBy: null,
        note: null,
      }
    }
    case "class_full":
      return {
        key: `class_full:${row.id}`,
        time: "All day",
        icon: "seats",
        task: "Class is full",
        who: row.className,
        // Once streams are on (#449, v42): who the class has no seat for, and
        // a stream that still has seats for the others.
        about: row.named ? `no free seat for ${row.named.need ? row.named.need.toLowerCase() : "any child"}` : `${row.taken} of ${row.seats} seats`,
        details: row.named
          ? row.named.elsewhere && row.named.need
            ? `${row.named.elsewhere} still has seats for ${row.named.need === "Boys" ? "girls" : "boys"}.`
            : "Open Seats to see who waits."
          : "No seats left. Open Seats to see who holds them.",
        action: { label: "Open Seats", href: "/staff/seats" },
        recordedBy: null,
        note: null,
      }
  }
}
