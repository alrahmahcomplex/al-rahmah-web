"use server"

import { revalidatePath } from "next/cache"

import { changeFollowUpDate, recordFollowUp, scheduleFollowUp, type RecordOutcome } from "@/lib/services/follow-ups"
import { isDeclinedReason } from "@/lib/services/lead-closure"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  changedOutcome,
  declinedOutcome,
  followUpOutcome,
  recordedOutcome,
  scheduledOutcome,
  type FollowUpOutcome,
} from "./follow-up-outcome"
import { fromTanzaniaLocal } from "./follow-up-record-format"

// Schedule follow-up, Change date and Record follow-up. Server Actions take
// input from anyone who can post to them, so the shape is checked here, and the database then
// checks the rules and the permission.

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "string" ? value : undefined
}

export async function scheduleLeadFollowUp(leadId: string, dueOn: string, note?: string | null): Promise<FollowUpOutcome> {
  const plannedNote = optionalText(note)
  if (typeof leadId !== "string") return followUpOutcome({ kind: "not-found" }, "schedule")
  if (typeof dueOn !== "string") return followUpOutcome({ kind: "invalid", field: "due_on" }, "schedule")
  if (plannedNote === undefined) return followUpOutcome({ kind: "invalid", field: "note" }, "schedule")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "follow_ups.record")
  if (!allowed.ok) return followUpOutcome({ kind: "forbidden" }, "schedule")

  const result = await scheduleFollowUp(supabase, leadId, { dueOn, note: plannedNote })
  if (!result.ok) return followUpOutcome(result.error, "schedule")
  revalidatePath(`/staff/leads/${leadId}`)
  return scheduledOutcome(dueOn)
}

export async function changeLeadFollowUpDate(
  leadId: string,
  followUpId: string,
  dueOn: string,
  reason: string,
  note?: string | null,
): Promise<FollowUpOutcome> {
  const newNote = optionalText(note)
  if (typeof leadId !== "string" || typeof followUpId !== "string") return followUpOutcome({ kind: "not-found" }, "change")
  if (typeof dueOn !== "string") return followUpOutcome({ kind: "invalid", field: "due_on" }, "change")
  if (typeof reason !== "string") return followUpOutcome({ kind: "invalid", field: "reason" }, "change")
  if (newNote === undefined) return followUpOutcome({ kind: "invalid", field: "note" }, "change")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "follow_ups.record")
  if (!allowed.ok) return followUpOutcome({ kind: "forbidden" }, "change")

  const result = await changeFollowUpDate(supabase, followUpId, { dueOn, reason, note: newNote })
  if (!result.ok) return followUpOutcome(result.error, "change")
  revalidatePath(`/staff/leads/${leadId}`)
  return changedOutcome(dueOn)
}

// What the Record follow-up form sends. The contact time is as typed, in
// Tanzania time. An empty next date asks to end with none, which the
// database allows only on an Enrolled lead. `decline` is set when the family
// will not proceed: the lead is declined with that reason, and no next date
// is planned.
export type ContactForm = {
  followUpId: string | null
  comment: string
  method: string
  contactedBy: string
  contactedAt: string
  nextDueOn: string
  nextNote: string
  decline?: { reason: string; note: string } | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function recordLeadFollowUp(leadId: string, form: ContactForm): Promise<FollowUpOutcome> {
  if (typeof leadId !== "string" || typeof form !== "object" || form === null) return followUpOutcome({ kind: "not-found" }, "record")
  if (form.followUpId !== null && typeof form.followUpId !== "string") return followUpOutcome({ kind: "conflict" }, "record")
  if (typeof form.comment !== "string") return followUpOutcome({ kind: "invalid", field: "comment" }, "record")
  if (typeof form.method !== "string") return followUpOutcome({ kind: "invalid", field: "method" }, "record")
  if (typeof form.contactedBy !== "string" || !UUID.test(form.contactedBy)) {
    return followUpOutcome({ kind: "invalid", field: "contacted_by" }, "record")
  }
  const contactedAt = typeof form.contactedAt === "string" ? fromTanzaniaLocal(form.contactedAt) : null
  if (!contactedAt) return followUpOutcome({ kind: "invalid", field: "contacted_at" }, "record")
  if (typeof form.nextDueOn !== "string") return followUpOutcome({ kind: "invalid", field: "next_due_on" }, "record")
  const nextNote = optionalText(form.nextNote)
  if (nextNote === undefined) return followUpOutcome({ kind: "invalid", field: "next_note" }, "record")
  const decline = form.decline ?? null
  const action = decline === null ? "record" : "decline"
  const declineReason = decline === null ? null : typeof decline === "object" ? decline.reason : undefined
  if (declineReason !== null && !isDeclinedReason(declineReason)) {
    return followUpOutcome({ kind: "invalid", field: "decline_reason" }, action)
  }
  const declineNote = decline === null ? null : optionalText(decline.note)
  if (declineNote === undefined) return followUpOutcome({ kind: "invalid", field: "decline_note" }, action)

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "follow_ups.record")
  if (!allowed.ok) return followUpOutcome({ kind: "forbidden" }, "record")

  const nextDueOn = form.nextDueOn.trim() === "" ? null : form.nextDueOn
  const outcome: RecordOutcome = declineReason
    ? { kind: "lead_declined", reason: declineReason, note: declineNote }
    : nextDueOn
      ? { kind: "next_date", dueOn: nextDueOn, note: nextNote }
      : { kind: "lead_enrolled" }
  const result = await recordFollowUp(supabase, leadId, {
    followUpId: form.followUpId,
    comment: form.comment,
    method: form.method,
    contactedBy: form.contactedBy,
    contactedAt,
    outcome,
  })
  if (!result.ok) return followUpOutcome(result.error, action)
  revalidatePath(`/staff/leads/${leadId}`)
  return declineReason ? declinedOutcome() : recordedOutcome(nextDueOn)
}
