"use server"

import { revalidatePath } from "next/cache"

import { correctFatherFullName, correctPreviousSchool, getSiblingLeadFacts, type PreviousSchoolType } from "@/lib/services/lead-details"
import { getLeadFee } from "@/lib/services/lead-fees"
import { explainSiblingGroup, type SiblingGroupExplanation } from "@/lib/services/sibling-counts"
import { decideSiblingRequest, previewSiblingGrant, requestSiblingDiscount } from "@/lib/services/sibling-requests"
import { getStaffUser } from "@/lib/services/staff-auth"
import { counts, firstName, type SiblingMemberView } from "@/lib/sibling-group-view"
import { createClient } from "@/utils/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { formatShillings } from "../../fees/format"
import { REGIONS } from "../../check-in/new/model"
import { decideRefusal, detailRefusal, requestRefusal, type Refused } from "./sibling-outcome"
import { describeGroupFor, type SiblingPerson } from "./sibling-read"

// The father's name, the previous school and Sibling requests on the lead
// record (#310). Server Actions take input from anyone who can post to
// them, so the shape is checked here, and the database then checks the
// permission and every rule.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value)
const NOT_READ: Refused = { status: "refused", message: "Some details could not be read. Reload the page and try again." }

// The father's name as the database compares it (normalize_father_name).
function sameFatherName(a: string | null, b: string | null): boolean {
  const norm = (name: string | null) =>
    (name ?? "")
      .toLowerCase()
      .replace(/[.,'’-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  return norm(a) !== "" && norm(a) === norm(b)
}

function revalidate(leadIds: string[]) {
  for (const id of new Set(leadIds)) revalidatePath(`/staff/applicants/${id}`)
  revalidatePath("/staff/applicants")
  revalidatePath("/staff/discounts")
}

// Each lead's student name and father's full name, or null when they
// can't be read.
async function fathersOf(supabase: SupabaseClient, ids: string[]): Promise<Map<string, { name: string; father: string | null }> | null> {
  const read = await getSiblingLeadFacts(supabase, ids)
  if (!read.ok) return null
  return new Map([...read.data.values()].map((r) => [r.id, { name: r.studentName, father: r.fatherFullName }]))
}

// Each member's School fee, for staff who may view payments; null otherwise.
async function feesOf(supabase: SupabaseClient, ids: string[]): Promise<Map<string, number> | null> {
  const reads = await Promise.all(ids.map((id) => getLeadFee(supabase, id)))
  if (reads.some((r) => !r.ok && r.error === "forbidden")) return null
  const fees = new Map<string, number>()
  reads.forEach((r, i) => {
    if (r.ok && r.data.kind === "fee") fees.set(ids[i], r.data.schoolFee)
  })
  return fees
}

const tzs = (amount: number) => `TZS ${formatShillings(amount)}`

// "Neema: TZS 1,800,000 becomes TZS 1,620,000."
function moves(group: SiblingGroupExplanation, before: Map<string, number> | null, after: Map<string, number> | null): string[] {
  if (!before || !after) return []
  return group.members.flatMap((m) => {
    const a = before.get(m.leadId)
    const b = after.get(m.leadId)
    return a !== undefined && b !== undefined && a !== b ? [`${firstName(m.studentName)}: ${tzs(a)} becomes ${tzs(b)}.`] : []
  })
}

export type FatherOutcome =
  | { status: "saved"; message: string }
  // Close names: nothing was saved. Ask the desk, then save again with the answer.
  | {
      status: "question"
      fatherFullName: string
      sibling: SiblingPerson
      // First names of the other records holding the sibling's spelling.
      holders: string[]
    }
  // Saved, and the student stopped counting: the names are different now.
  | { status: "different"; father: string; sibling: SiblingPerson | null; sentence: string; moves: string[] }
  // Saved as two names at the desk: go straight to the request.
  | { status: "ask-request" }
  // Saved, and the name now matches a sibling's while a request path is open.
  | { status: "same-now"; father: string; sibling: SiblingPerson; pending: boolean }
  | Refused

const basisCounts = (basis: string | null | undefined) => basis === "matched" || basis === "typo_confirmed"

export async function saveFatherName(
  leadId: string,
  fatherFullName: string,
  answer: "typo-mine" | "typo-theirs" | "different" | null,
  siblingFather: string | null,
): Promise<FatherOutcome> {
  if (!isId(leadId) || typeof fatherFullName !== "string" || fatherFullName.trim() === "") return NOT_READ
  if (answer !== null && answer !== "typo-mine" && answer !== "typo-theirs" && answer !== "different") return NOT_READ
  if (answer === "typo-theirs" && typeof siblingFather !== "string") return NOT_READ

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("leads.edit")) return detailRefusal({ kind: "forbidden" })
  const seesFees = staff.data.permissions.includes("payments.view")

  const before = await explainSiblingGroup(supabase, leadId)
  if (!before.ok) return before.error === "not-found" ? detailRefusal({ kind: "not-found" }) : detailRefusal({ kind: "unavailable" })
  const ids = before.data.members.map((m) => m.leadId)
  const hereBefore = before.data.members.find((m) => m.leadId === leadId)
  const feesBefore = seesFees && before.data.groupId ? await feesOf(supabase, ids) : null

  const saved = await correctFatherFullName(supabase, leadId, {
    fatherFullName,
    ...(answer === "different" ? { answer: "different" as const } : {}),
    ...(answer === "typo-mine" ? { answer: "typo" as const, spelling: fatherFullName } : {}),
    ...(answer === "typo-theirs" ? { answer: "typo" as const, spelling: siblingFather ?? "" } : {}),
  })
  if (!saved.ok) {
    if (saved.error.kind !== "father-name-question") return detailRefusal(saved.error)
    const question = saved.error
    const people = await fathersOf(supabase, [question.siblingLeadId, ...ids])
    // Nothing was saved yet, so a failed read refuses rather than ask with names missing.
    if (!people) return detailRefusal({ kind: "unavailable" })
    const them = people.get(question.siblingLeadId)
    const holders: string[] = []
    for (const id of ids) {
      if (id !== leadId && (sameFatherName(people.get(id)?.father ?? null, question.siblingFatherFullName))) {
        holders.push(firstName(people.get(id)?.name ?? ""))
      }
    }
    return {
      status: "question",
      fatherFullName: question.fatherFullName,
      sibling: {
        leadId: question.siblingLeadId,
        firstName: firstName(them?.name ?? ""),
        studentName: them?.name ?? "",
        father: question.siblingFatherFullName,
      },
      holders,
    }
  }
  revalidate(ids.concat(leadId))

  if (answer === "different") return { status: "ask-request" }
  if (answer === "typo-mine") {
    const people = await fathersOf(supabase, ids)
    let records = 0
    for (const id of ids) if (sameFatherName(people?.get(id)?.father ?? null, fatherFullName)) records++
    return {
      status: "saved",
      message: people && records > 1 ? `Saved as one name on ${records} records. Still siblings.` : "Saved as one name. Still siblings.",
    }
  }
  if (answer === "typo-theirs") return { status: "saved", message: "Saved as one name. Still siblings." }

  const after = await explainSiblingGroup(supabase, leadId)
  if (!after.ok || !hereBefore || !before.data.groupId) return { status: "saved", message: "Father’s name saved." }
  const hereAfter = after.data.members.find((m) => m.leadId === leadId)
  const people = await fathersOf(supabase, after.data.members.map((m) => m.leadId))
  if (!people) return { status: "saved", message: "Father’s name saved." }
  const person = (id: string): SiblingPerson => {
    const p = people.get(id)
    return { leadId: id, firstName: firstName(p?.name ?? ""), studentName: p?.name ?? "", father: p?.father ?? null }
  }
  const countingOthers = after.data.members.filter((m) => m.leadId !== leadId && counts(m))
  const father = people.get(leadId)?.father ?? fatherFullName

  if (basisCounts(hereBefore.basis) && hereAfter?.basis === "request_needed") {
    const feesAfter = seesFees ? await feesOf(supabase, ids) : null
    const described = await describeGroupFor(supabase, after.data, leadId)
    const mine = described?.members.find((m) => m.here)
    const sibling = countingOthers[0] ?? after.data.members.find((m) => m.leadId !== leadId)
    return {
      status: "different",
      father,
      sibling: sibling ? person(sibling.leadId) : null,
      sentence: mine?.sentence.en ?? "",
      moves: moves(after.data, feesBefore, feesAfter),
    }
  }

  let match: string | null = null
  for (const m of countingOthers) {
    if (sameFatherName(people.get(m.leadId)?.father ?? null, father)) {
      match = m.leadId
      break
    }
  }
  if (match && !hereBefore.legacy && (hereBefore.basis === "request_needed" || hereBefore.basis === "refused")) {
    return { status: "same-now", father, sibling: person(match), pending: hereAfter?.pendingRequest != null }
  }
  if (match && basisCounts(hereBefore.basis)) {
    return { status: "saved", message: `Father’s name saved. Same name as ${person(match).firstName}’s father.` }
  }
  return { status: "saved", message: "Father’s name saved." }
}

export type SchoolInput = { kind: "school"; name: string; type: PreviousSchoolType; region: string } | { kind: "not-known" }

export async function savePreviousSchool(leadId: string, school: SchoolInput): Promise<{ status: "saved" } | Refused> {
  if (!isId(leadId) || !school || typeof school !== "object") return NOT_READ
  if (school.kind === "school") {
    if (typeof school.name !== "string" || school.name.trim().length < 2) {
      return { status: "refused", field: "previous_school_name", message: "Type the school’s name." }
    }
    if ((school.type !== "private" && school.type !== "public") || !REGIONS.includes(school.region)) {
      return { status: "refused", field: "previous_school_type", message: "Choose private or public, and the region." }
    }
  } else if (school.kind !== "not-known") return NOT_READ

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("leads.edit")) return detailRefusal({ kind: "forbidden" })
  const saved = await correctPreviousSchool(
    supabase,
    leadId,
    school.kind === "school" ? { kind: "school", name: school.name.trim().replace(/\s+/g, " "), type: school.type, region: school.region } : school,
  )
  if (!saved.ok) return detailRefusal(saved.error)
  revalidate([leadId])
  return { status: "saved" }
}

// `requestId` is the sheet's id for this request, the same on every retry.
export async function sendSiblingRequest(leadId: string, note: string, requestId: string): Promise<{ status: "sent" } | Refused> {
  if (!isId(leadId) || !isId(requestId) || typeof note !== "string") return NOT_READ
  const clean = note.trim().replace(/\s+/g, " ")
  if (clean === "") return { status: "refused", field: "note", message: "Write what proof the family will bring." }
  if (clean.length > 1000) return { status: "refused", field: "note", message: "Write what proof the family will bring, in at most 1,000 characters." }

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("leads.edit")) return requestRefusal({ kind: "forbidden" })
  const sent = await requestSiblingDiscount(supabase, { leadId, note: clean, requestId })
  if (!sent.ok) return requestRefusal(sent.error)
  revalidate([leadId])
  return { status: "sent" }
}

export type GrantPreviewView = {
  status: "ready"
  // English only: the Manager reads the group as it would be. Null for a
  // role without leads.view, which sees no group.
  members: (Pick<SiblingMemberView, "leadId" | "firstName" | "chip" | "sentence"> & { feeEditNeeded: boolean })[] | null
  // Null for staff who may not view payments.
  changes: string[] | null
  // The member the request compares the father's name with, for a request
  // that names none: one that counts, else the first other member.
  compareWith: SiblingPerson | null
}

export async function previewGrant(requestId: string, leadId: string): Promise<GrantPreviewView | Refused> {
  if (!isId(requestId) || !isId(leadId)) return NOT_READ
  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("discounts.approve")) return decideRefusal("forbidden", "preview")

  const preview = await previewSiblingGrant(supabase, requestId)
  if (!preview.ok) return decideRefusal(preview.error, "preview")
  const { explanation, fullPayerTie, changes } = preview.data
  // "Neema: TZS 1,800,000 becomes TZS 1,620,000.", for staff who may view payments.
  const lines =
    changes &&
    changes.flatMap((c) =>
      c.before !== null && c.after !== null ? [`${firstName(c.studentName)}: ${tzs(c.before)} becomes ${tzs(c.after)}.`] : [],
    )
  // A role that may approve discounts without viewing leads sees the fees, not the group.
  if (!explanation) return { status: "ready", compareWith: null, members: null, changes: lines }
  const described = await describeGroupFor(supabase, explanation, leadId, fullPayerTie)
  if (!described) return decideRefusal("unavailable", "preview")
  const others = explanation.members.filter((m) => m.leadId !== leadId)
  const compare = others.find(counts) ?? others[0] ?? null
  const row = compare ? described.leads.get(compare.leadId) : undefined
  return {
    status: "ready",
    compareWith: compare && {
      leadId: compare.leadId,
      firstName: firstName(row?.studentName ?? compare.studentName),
      studentName: row?.studentName ?? compare.studentName,
      father: row?.fatherFullName ?? null,
    },
    members: described.members.map((m) => ({
      leadId: m.leadId,
      firstName: m.firstName,
      chip: m.chip,
      sentence: m.sentence,
      feeEditNeeded: m.notes.some((n) => n.note === "fee_edit_needed"),
    })),
    changes: lines,
  }
}

export async function decideSibling(
  leadId: string,
  requestId: string,
  decision: "grant" | "refuse",
  reason: string | null,
): Promise<{ status: "done" } | Refused> {
  if (!isId(leadId) || !isId(requestId) || (decision !== "grant" && decision !== "refuse")) return NOT_READ
  if (decision === "refuse" && (typeof reason !== "string" || reason.trim() === "")) {
    return { status: "refused", message: "Write why it is refused." }
  }
  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("discounts.approve")) return decideRefusal("forbidden", decision)

  const before = await explainSiblingGroup(supabase, leadId)
  const decided = await decideSiblingRequest(
    supabase,
    requestId,
    decision === "grant" ? { decision: "grant" } : { decision: "refuse", reason: (reason ?? "").trim() },
  )
  if (!decided.ok) return decideRefusal(decided.error, decision)
  revalidate([leadId, ...(before.ok ? before.data.members.map((m) => m.leadId) : [])])
  return { status: "done" }
}
