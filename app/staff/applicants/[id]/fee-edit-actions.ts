"use server"

import { revalidatePath } from "next/cache"

import { getLeadFee } from "@/lib/services/lead-fees"
import { explainSiblingGroup } from "@/lib/services/sibling-counts"
import {
  editSiblingFee,
  previewSiblingFeeEdit,
  type SiblingFeeEditReason,
  type SiblingFeeEditValue,
} from "@/lib/services/sibling-groups"
import { dismissSiblingFeeEdit } from "@/lib/services/sibling-requests"
import { getStaffUser } from "@/lib/services/staff-auth"
import { firstName } from "@/lib/sibling-group-view"
import { createClient } from "@/utils/supabase/server"

import { FEE_EDIT_REASON_ORDER, FEE_EDIT_VALUES, NOTE_MAX, feeEditRefusal, feeWhy, keepFeeRefusal } from "./fee-edit-outcome"
import type { Refused } from "./sibling-outcome"

// The Accountant's Sibling fee edit and "Leave the fee as it is" (#311).
// Server Actions take input from anyone who can post to them, so the shape
// and the permission are checked here; the database then checks the
// permission and every rule again (edit_sibling_fee, dismiss_sibling_fee_edit).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value)
const isValue = (value: unknown): value is SiblingFeeEditValue => FEE_EDIT_VALUES.some((v) => v.value === value)
const isReason = (value: unknown): value is SiblingFeeEditReason => FEE_EDIT_REASON_ORDER.includes(value as SiblingFeeEditReason)
const NOT_READ: Refused = { status: "refused", message: "Some details could not be read. Reload the page and try again." }
const clean = (text: string) => text.trim().replace(/\s+/g, " ")

// One sibling in "Before you save": the edited student first, then the
// group in its own order. Amounts are whole TZS; null when the lead's year
// has no Fee schedule.
export type FeeEditRow = {
  leadId: string
  firstName: string
  status: string
  here: boolean
  before: number | null
  after: number | null
  // The fee after: "Full fee", "Sibling 10%" or a larger discount.
  afterWhy: string
  changed: boolean
}

export type FeeEditPreview = {
  status: "ready"
  rows: FeeEditRow[]
  // The same manual value again, or Back to automatic on an automatic
  // result: saving it would change nothing.
  unchanged: boolean
}

async function recorder() {
  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  return { supabase, allowed: staff.ok && staff.data.permissions.includes("payments.record") }
}

function revalidate(leadIds: string[]) {
  for (const id of new Set(leadIds)) revalidatePath(`/staff/applicants/${id}`)
  revalidatePath("/staff/applicants")
  revalidatePath("/staff/reports")
}

export async function previewFeeEdit(leadId: string, value: SiblingFeeEditValue): Promise<FeeEditPreview | Refused> {
  if (!isId(leadId) || !isValue(value)) return NOT_READ
  const { supabase, allowed } = await recorder()
  if (!allowed) return feeEditRefusal({ kind: "forbidden" }, "preview")

  const [explained, preview] = await Promise.all([explainSiblingGroup(supabase, leadId), previewSiblingFeeEdit(supabase, leadId, value)])
  if (!explained.ok) return explained.error === "not-found" ? feeEditRefusal({ kind: "not-found" }, "preview") : NOT_READ
  const unchanged = !preview.ok && preview.error.kind === "unchanged"
  if (!preview.ok && !unchanged) return feeEditRefusal(preview.error, "preview")
  const changes = new Map((preview.ok ? preview.data.changes : []).map((c) => [c.leadId, c]))

  const members = [...explained.data.members].sort((a, b) => Number(b.leadId === leadId) - Number(a.leadId === leadId))
  const fees = await Promise.all(members.map((m) => (changes.has(m.leadId) ? null : getLeadFee(supabase, m.leadId))))
  if (fees.some((f) => f && !f.ok)) return NOT_READ

  return {
    status: "ready",
    unchanged,
    rows: members.map((m, i) => {
      const change = changes.get(m.leadId)
      const fee = fees[i]
      const now = fee?.ok && fee.data.kind === "fee" ? fee.data : null
      return change
        ? {
            leadId: m.leadId,
            firstName: firstName(m.studentName),
            status: m.status,
            here: m.leadId === leadId,
            before: change.before.schoolFee,
            after: change.after.schoolFee,
            afterWhy: feeWhy(change.after.discount),
            changed: change.before.schoolFee !== change.after.schoolFee,
          }
        : {
            leadId: m.leadId,
            firstName: firstName(m.studentName),
            status: m.status,
            here: m.leadId === leadId,
            before: now?.schoolFee ?? null,
            after: now?.schoolFee ?? null,
            afterWhy: feeWhy(now?.discount?.kind ?? null),
            changed: false,
          }
    }),
  }
}

export async function saveFeeEdit(
  leadId: string,
  value: SiblingFeeEditValue,
  reason: SiblingFeeEditReason,
  note: string,
  requestId: string,
): Promise<{ status: "saved"; leadIds: string[] } | Refused> {
  if (!isId(leadId) || !isId(requestId) || typeof note !== "string") return NOT_READ
  if (!isValue(value)) return { status: "refused", message: "Choose the fee." }
  if (!isReason(reason)) return { status: "refused", message: "Choose the reason." }
  const text = clean(note)
  if (text.length > NOTE_MAX) return feeEditRefusal({ kind: "invalid", field: "note" }, "save")

  const { supabase, allowed } = await recorder()
  if (!allowed) return feeEditRefusal({ kind: "forbidden" }, "save")
  const saved = await editSiblingFee(supabase, { leadId, value, reason, note: text || undefined }, requestId)
  if (!saved.ok) return feeEditRefusal(saved.error, "save")
  const leadIds = [leadId, ...saved.data.changes.map((c) => c.leadId)]
  revalidate(leadIds)
  return { status: "saved", leadIds }
}

export async function leaveFeeAsItIs(leadId: string, reason: string): Promise<{ status: "saved" } | Refused> {
  if (!isId(leadId) || typeof reason !== "string") return NOT_READ
  const text = clean(reason)
  if (text === "") return keepFeeRefusal("invalid")
  if (text.length > NOTE_MAX) {
    return { status: "refused", field: "note", message: `Write why the fee stays as it is, in at most ${NOTE_MAX.toLocaleString("en-GB")} characters.` }
  }

  const { supabase, allowed } = await recorder()
  if (!allowed) return keepFeeRefusal("forbidden")
  const kept = await dismissSiblingFeeEdit(supabase, leadId, text)
  if (!kept.ok) return keepFeeRefusal(kept.error)
  revalidate([leadId])
  return { status: "saved" }
}
