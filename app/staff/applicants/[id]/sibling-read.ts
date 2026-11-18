import "server-only"

import type { Permission } from "@/lib/permissions"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getFullPayerTie, explainSiblingGroup } from "@/lib/services/sibling-counts"
import { getPriorSibling } from "@/lib/services/sibling-groups"
import { getLeadSiblingRequests } from "@/lib/services/sibling-requests"
import { counts, describeSiblingGroup, firstName, outsideNames, type SiblingMemberView } from "@/lib/sibling-group-view"
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
}

type LeadRow = { id: string; student_name: string; closure: "Inactive" | "Archived" | null; father_full_name: string | null }

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
): Promise<{ members: SiblingMemberView[]; leads: Map<string, LeadRow> } | null> {
  const ids = [...new Set([...group.members.map((m) => m.leadId), ...outsideNames(group)])]
  const { data, error } = await supabase.from("leads").select("id, student_name, closure, father_full_name").in("id", ids)
  if (error) {
    console.error("Could not read a sibling group's leads", error)
    return null
  }
  const leads = new Map((data as LeadRow[]).map((row) => [row.id, row]))

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
    names[row.id] = row.student_name
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
    const name = leads.get(id)?.student_name ?? group.members.find((m) => m.leadId === id)?.studentName ?? ""
    return { leadId: id, firstName: firstName(name), studentName: name, father: leads.get(id)?.father_full_name ?? null }
  }

  const waiting = requests.data.find((r) => r.state === "pending") ?? null
  const others = group.members.filter((m) => m.leadId !== leadId)
  const compare = others.find(counts) ?? others[0] ?? null

  return {
    leadId,
    studentName: here.studentName,
    enrolled: here.status === "Enrolled",
    father: leads.get(leadId)?.father_full_name ?? null,
    inGroup: group.groupId !== null,
    members,
    pending: waiting && {
      requestId: waiting.id,
      requestedBy: waiting.requestedBy ?? "a staff member",
      requestedOn: dayOf(waiting.requestedAt),
      waitingDays: daysBetween(tanzaniaToday(new Date(waiting.requestedAt)), tanzaniaToday()),
      note: waiting.note,
      sibling: waiting.siblingOfLeadId ? person(waiting.siblingOfLeadId) : compare && person(compare.leadId),
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
  }
}
