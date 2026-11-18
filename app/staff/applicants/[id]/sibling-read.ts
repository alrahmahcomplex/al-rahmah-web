import "server-only"

import type { Permission } from "@/lib/permissions"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getSiblingLeadFacts, type SiblingLeadFacts } from "@/lib/services/lead-details"
import { getFullPayerTie, explainSiblingGroup } from "@/lib/services/sibling-counts"
import { getPriorSibling, getSiblingFeeEditNote } from "@/lib/services/sibling-groups"
import { getLeadSiblingRequests } from "@/lib/services/sibling-requests"
import { counts, describeSiblingGroup, firstName, outsideNames, type SiblingMemberView } from "@/lib/sibling-group-view"
import { FEE_EDIT_REASONS, list } from "@/lib/sibling-sentences"
import type { SiblingGroupExplanation } from "@/lib/services/sibling-counts"
import type { SupabaseClient } from "@supabase/supabase-js"

import { dayOf } from "./reopening-outcome"

// The Sibling group on a lead's record and in the Applicants side sheet
// (#310): every member with its fee chip and sentence, the Sibling request
// that waits on the lead, and what the staff member may do about it.

export type SiblingPerson = { leadId: string; firstName: string; studentName: string; father: string | null }

export type PendingSiblingView = {
  requestId: string
  requestedBy: string
  requestedOn: string
  // Whole days since it was sent; 0 the same day.
  waitingDays: number
  note: string
  // The sibling it names, when it names one.
  sibling: SiblingPerson | null
}

export type SiblingGroupView = {
  leadId: string
  studentName: string
  enrolled: boolean
  father: string | null
  inGroup: boolean
  members: SiblingMemberView[]
  pending: PendingSiblingView | null
  // Whom a new request compares the father's name with: a member that
  // counts, else the first other member.
  compareWith: SiblingPerson | null
  canRequest: boolean
  canReview: boolean
  // The lead's own Sibling fee, for the School fee section (#311).
  fee: SiblingFeeFacts
}

export type SiblingFeeFacts = {
  // payments.record on an open lead that is in a Sibling group or holds a
  // value set by hand: the Sibling fee edit.
  canEdit: boolean
  // "Granted: fee edit needed" on the lead.
  feeEditNeeded: boolean
  // payments.record while it is needed: "Leave the fee as it is". The
  // database allows it on a closed lead too.
  canKeep: boolean
  // The value set by hand in force, for staff who may view payments.
  setByHand: { staff: string; date: string; reason: string; note: string | null } | null
  // What the payment form says while a Sibling request waits.
  paymentNote: string | null
}


const dateOf = (at: string) => formatDate(tanzaniaToday(new Date(at)))

// Days between two Tanzanian dates, "YYYY-MM-DD".
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000))
}

// Builds the member rows of an explanation: reads the names, closure marks,
// ticked siblings and the full payer's tie the sentences need.
export async function describeGroupFor(
  supabase: SupabaseClient,
  group: SiblingGroupExplanation,
  hereLeadId: string,
  fullPayerTie?: boolean | null,
): Promise<{ members: SiblingMemberView[]; leads: Map<string, SiblingLeadFacts> } | null> {
  const ids = [...new Set([...group.members.map((m) => m.leadId), ...outsideNames(group)])]
  const read = await getSiblingLeadFacts(supabase, ids)
  if (!read.ok) return null
  const leads = read.data

  const ticked = group.members.filter((m) => m.reason === "prior_sibling")
  const priors = await Promise.all(ticked.map((m) => getPriorSibling(supabase, m.leadId)))
  const priorSiblings: Record<string, string> = {}
  ticked.forEach((m, i) => {
    const prior = priors[i]
    if (prior.ok && prior.data) priorSiblings[m.leadId] = `${prior.data.name}, ${prior.data.className}`
  })

  let tie = fullPayerTie ?? null
  const payer = group.members.find((m) => m.fullPayer && m.highestFee === true)
  if (fullPayerTie === undefined && payer) {
    const read = await getFullPayerTie(supabase, payer.leadId)
    tie = read.ok ? read.data : null
  }

  const closures: Record<string, "Inactive" | "Archived"> = {}
  const names: Record<string, string> = {}
  for (const row of leads.values()) {
    names[row.id] = row.studentName
    if (row.closure) closures[row.id] = row.closure
  }

  return {
    members: describeSiblingGroup(group, { names, closures, priorSiblings, fullPayerTie: tie, formatDate: dateOf }, hereLeadId),
    leads,
  }
}

export async function readSiblingGroup(
  supabase: SupabaseClient,
  leadId: string,
  permissions: readonly Permission[],
): Promise<SiblingGroupView | null> {
  const [explained, requests] = await Promise.all([explainSiblingGroup(supabase, leadId), getLeadSiblingRequests(supabase, leadId)])
  if (!explained.ok || !requests.ok) return null
  const group = explained.data
  const described = await describeGroupFor(supabase, group, leadId)
  if (!described) return null
  const { members, leads } = described

  const here = group.members.find((m) => m.leadId === leadId)
  if (!here) return null
  const person = (id: string): SiblingPerson => {
    const name = leads.get(id)?.studentName ?? group.members.find((m) => m.leadId === id)?.studentName ?? ""
    return { leadId: id, firstName: firstName(name), studentName: name, father: leads.get(id)?.fatherFullName ?? null }
  }

  const waiting = requests.data.find((r) => r.state === "pending") ?? null
  const others = group.members.filter((m) => m.leadId !== leadId)
  const compare = others.find(counts) ?? others[0] ?? null
  const pendingSibling: SiblingPerson | null = waiting
    ? waiting.siblingOfLeadId
      ? {
          leadId: waiting.siblingOfLeadId,
          firstName: firstName(waiting.siblingOfStudentName ?? ""),
          studentName: waiting.siblingOfStudentName ?? "",
          father: waiting.siblingOfFatherFullName,
        }
      : compare && person(compare.leadId)
    : null

  const recorder = permissions.includes("payments.record")
  const edit = here.source === "manual" && here.feeEdit && here.feeEdit.value !== "automatic" ? here.feeEdit : null
  const note = edit ? await getSiblingFeeEditNote(supabase, edit.editId) : null
  const feeEditNeeded = here.notes.includes("fee_edit_needed")

  return {
    leadId,
    studentName: here.studentName,
    enrolled: here.status === "Enrolled",
    father: leads.get(leadId)?.fatherFullName ?? null,
    inGroup: group.groupId !== null,
    members,
    pending: waiting && {
      requestId: waiting.id,
      requestedBy: waiting.requestedBy ?? "a staff member",
      requestedOn: dayOf(waiting.requestedAt),
      waitingDays: daysBetween(tanzaniaToday(new Date(waiting.requestedAt)), tanzaniaToday()),
      note: waiting.note,
      // A request across groups names a sibling outside this group: the
      // request carries its name and father's name.
      sibling: pendingSibling,
    },
    compareWith: compare && person(compare.leadId),
    canRequest:
      permissions.includes("leads.edit") &&
      here.leadOpen &&
      group.groupId !== null &&
      !here.legacy &&
      (here.basis === "request_needed" || here.basis === "refused") &&
      !waiting,
    canReview: permissions.includes("discounts.approve") && waiting !== null,
    fee: {
      canEdit: recorder && here.leadOpen && (group.groupId !== null || here.source === "manual"),
      feeEditNeeded,
      canKeep: recorder && feeEditNeeded,
      setByHand: edit && {
        staff: edit.staffName,
        date: dateOf(edit.createdAt),
        reason: FEE_EDIT_REASONS[edit.reason].en,
        note: note?.ok ? note.data : null,
      },
      paymentNote: waiting
        ? `A Sibling request for ${list([firstName(here.studentName), ...(pendingSibling?.firstName ? [pendingSibling.firstName] : [])], "and")} is waiting. Recorded at the full fee for now. If the request is granted, the fee can be edited.`
        : null,
    },
  }
}
