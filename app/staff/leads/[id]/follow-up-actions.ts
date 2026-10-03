"use server"

import { revalidatePath } from "next/cache"

import { changeFollowUpDate, scheduleFollowUp } from "@/lib/services/follow-ups"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { changedOutcome, followUpOutcome, scheduledOutcome, type FollowUpOutcome } from "./follow-up-outcome"

// Schedule follow-up and Change date. Server Actions take input from anyone
// who can post to them, so the shape is checked here, and the database then
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
