import type { SupabaseClient } from "@supabase/supabase-js"

import type { ClassSeatFigures } from "./dashboard-seats"
import type { FeeDiscountKind } from "./discounts"
import type { InterviewResult } from "./interviews"
import type { LeadClass, LeadClosure, LeadStatus, Relationship } from "./leads"
import type { ReApplicationField } from "./re-applications"
import type { Result } from "./result"
import type { PaymentType } from "./school-fee-payments"

// Home's Activity log (#406): what happened today and what is still waiting
// for someone. The database function home_activity reads every kind but the
// full classes, checking each kind's permission itself (see its migration);
// the full classes come from the seats Home already reads, for those who may
// open Seats, and go first. Both are paged together, ten rows a page.

export const ACTIVITY_PER_PAGE = 10
// The highest page asked for. Far beyond any real log, and its offset stays
// inside the database's integer.
export const ACTIVITY_LAST_PAGE = 100_000

export type ActivityLead = {
  leadId: string
  admissionNumber: string
  studentName: string
  className: LeadClass
}

type Timed = { id: string; at: string }

export type ActivityRow =
  // An Admission form sent in the 7 days before today, naming only its
  // children still Applied and open.
  | (Timed & { kind: "expected"; sentOn: string; children: ActivityLead[] })
  | (Timed &
      ActivityLead & { kind: "new_application"; referralCode: string | null; status: LeadStatus; closure: LeadClosure | null })
  | (Timed &
      ActivityLead & {
        kind: "result_ready"
        interviewDate: string
        result: InterviewResult
        score: number
        // True when a release went out and the result or score changed since.
        changedSinceSent: boolean
      })
  | (Timed & ActivityLead & { kind: "discount_request"; discount: FeeDiscountKind; note: string; requestedBy: string | null })
  | (Timed & { kind: "agent_claim"; agentId: string; fullName: string; code: string; claims: number })
  | (Timed & ActivityLead & { kind: "re_application"; askedClass: LeadClass; differingFields: ReApplicationField[] })
  | (Timed & ActivityLead & { kind: "fee_paid"; paymentType: PaymentType; amount: number; recordedBy: string | null })
  | (Timed &
      ActivityLead & {
        kind: "call_back"
        dueOn: string
        note: string | null
        custodianName: string
        relationship: Relationship
        relationshipDescription: string | null
      })
  | { kind: "class_full"; id: string; className: LeadClass; taken: number; seats: number; named?: FullClassNeed }

export type ActivityPage = { rows: ActivityRow[]; total: number; page: number; pageCount: number }

/**
 * Once streams are on (#449, v42): which children the class has no free seat
 * for (boys, girls, or any child in a class of Mixed streams), and a stream of
 * the class that still has seats for the others, by name.
 */
export type FullClassNeed = { need: "Boys" | "Girls" | null; elsewhere: string | null }

export type FullClass = { className: LeadClass; taken: number; seats: number; named?: FullClassNeed }

/**
 * The classes with no seat left, in class order: every seat kind of the class
 * is set and taken, as Home's Seats caption counts it. Day and boarding seats
 * are added together.
 */
export function fullClasses(classes: readonly ClassSeatFigures[]): FullClass[] {
  const byClass = new Map<LeadClass, ClassSeatFigures[]>()
  for (const entry of classes) byClass.set(entry.className, [...(byClass.get(entry.className) ?? []), entry])
  const full: FullClass[] = []
  for (const [className, entries] of byClass) {
    if (!entries.every((entry) => entry.seats !== null && entry.taken >= entry.seats)) continue
    full.push({
      className,
      taken: entries.reduce((sum, entry) => sum + entry.taken, 0),
      seats: entries.reduce((sum, entry) => sum + (entry.seats ?? 0), 0),
    })
  }
  return full
}

/**
 * Where page `page` falls when `ahead` rows come before the database's: which
 * of those rows it shows, and the offset and limit to ask the database for.
 * The limit is at least 1, so the total always comes back.
 */
export function activityWindow(page: number, ahead: number) {
  const start = (page - 1) * ACTIVITY_PER_PAGE
  const end = start + ACTIVITY_PER_PAGE
  const aheadShown = { from: Math.min(start, ahead), to: Math.min(end, ahead) }
  const offset = Math.max(0, start - ahead)
  const wanted = end - Math.max(start, ahead)
  return { aheadShown, offset, limit: Math.max(1, wanted), wanted: Math.max(0, wanted) }
}

type Row = Record<string, unknown> & { kind: string; id: string; at: string }

function lead(row: Row): ActivityLead {
  return {
    leadId: row.lead_id as string,
    admissionNumber: row.admission_number as string,
    studentName: row.student_name as string,
    className: row.class_name as LeadClass,
  }
}

function toRow(row: Row): ActivityRow | null {
  const base = { id: row.id, at: row.at }
  switch (row.kind) {
    case "expected":
      return {
        ...base,
        kind: "expected",
        sentOn: row.sent_on as string,
        children: (row.children as Row[]).map(lead),
      }
    case "new_application":
      return {
        ...base,
        ...lead(row),
        kind: "new_application",
        referralCode: (row.referral_code as string | null) ?? null,
        status: row.status as LeadStatus,
        closure: (row.closure as LeadClosure | null) ?? null,
      }
    case "result_ready":
      return {
        ...base,
        ...lead(row),
        kind: "result_ready",
        interviewDate: row.interview_date as string,
        result: row.result as InterviewResult,
        score: Number(row.score),
        changedSinceSent: row.changed_since_sent === true,
      }
    case "discount_request":
      return {
        ...base,
        ...lead(row),
        kind: "discount_request",
        discount: row.discount as FeeDiscountKind,
        note: row.note as string,
        requestedBy: (row.requested_by as string | null) ?? null,
      }
    case "agent_claim":
      return {
        ...base,
        kind: "agent_claim",
        agentId: row.agent_id as string,
        fullName: row.full_name as string,
        code: row.code as string,
        claims: Number(row.claims),
      }
    case "re_application":
      return {
        ...base,
        ...lead(row),
        kind: "re_application",
        askedClass: row.asked_class as LeadClass,
        differingFields: (row.differing_fields as ReApplicationField[]) ?? [],
      }
    case "fee_paid":
      return {
        ...base,
        ...lead(row),
        kind: "fee_paid",
        paymentType: row.payment_type as PaymentType,
        amount: Number(row.amount),
        recordedBy: (row.recorded_by as string | null) ?? null,
      }
    case "call_back":
      return {
        ...base,
        ...lead(row),
        kind: "call_back",
        dueOn: row.due_on as string,
        note: (row.note as string | null) ?? null,
        custodianName: row.custodian_name as string,
        relationship: row.relationship as Relationship,
        relationshipDescription: (row.relationship_description as string | null) ?? null,
      }
    default:
      // A kind a later migration adds before this file knows it.
      console.error(`Unknown activity kind ${row.kind}`)
      return null
  }
}

/**
 * One page (from 1) of the Activity log, with `full` (from fullClasses, for
 * those who may open Seats; empty otherwise) first. A page past the end
 * comes back empty with the real total. `forbidden` when the caller sees no
 * kind at all.
 */
export async function getHomeActivity(
  supabase: SupabaseClient,
  page: number,
  full: readonly FullClass[] = [],
): Promise<Result<ActivityPage, "forbidden" | "unavailable">> {
  const shownPage = Number.isInteger(page) && page >= 1 ? Math.min(page, ACTIVITY_LAST_PAGE) : 1
  const window = activityWindow(shownPage, full.length)
  const { data, error } = await supabase.rpc("home_activity", { row_offset: window.offset, row_limit: window.limit })

  let dbRows: ActivityRow[] = []
  let dbTotal = 0
  if (error) {
    const refused = error.message === "not_permitted" || error.code === "42501"
    if (!refused) {
      console.error("Could not read the activity log", error)
      return { ok: false, error: "unavailable" }
    }
    if (full.length === 0) return { ok: false, error: "forbidden" }
  } else {
    const answer = data as { total: number; rows: Row[] }
    dbTotal = answer.total
    dbRows = answer.rows
      .slice(0, window.wanted)
      .map(toRow)
      .filter((row): row is ActivityRow => row !== null)
  }

  const classRows: ActivityRow[] = full
    .slice(window.aheadShown.from, window.aheadShown.to)
    .map((entry) => ({ kind: "class_full", id: entry.named ? `${entry.className} ${entry.named.need ?? "any"}` : entry.className, ...entry }))
  const total = full.length + dbTotal
  return {
    ok: true,
    data: {
      rows: [...classRows, ...dbRows],
      total,
      page: shownPage,
      pageCount: Math.max(1, Math.ceil(total / ACTIVITY_PER_PAGE)),
    },
  }
}
