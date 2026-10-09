"use server"

import { revalidatePath } from "next/cache"

import { decideDiscount, isDiscountKind, requestDiscount } from "@/lib/services/discounts"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { canDecideDiscount, canRequestDiscount, decideOutcome, requestOutcome, type DiscountOutcome } from "./discount-outcome"

// Requesting, granting and refusing a Staff child or Qualified orphan
// discount (#112). Server Actions take input from anyone who can post to
// them, so the shape is checked here, and the database then checks the
// permission and every rule.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `requestId` is the form's id for this request, the same on every retry, so
// a retried Request sends it once.
export async function requestDiscountAction(
  leadId: string,
  kind: string,
  note: string,
  requestId: string,
): Promise<DiscountOutcome> {
  if (typeof leadId !== "string") return requestOutcome({ kind: "not-found" })
  if (!isDiscountKind(kind)) return requestOutcome({ kind: "invalid", field: "kind" })
  if (typeof note !== "string") return requestOutcome({ kind: "invalid", field: "note" })
  if (typeof requestId !== "string" || !UUID.test(requestId)) return requestOutcome({ kind: "unavailable" })

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canRequestDiscount(staff.data.permissions)) return requestOutcome({ kind: "forbidden" })

  const result = await requestDiscount(supabase, leadId, kind, note, requestId)
  if (!result.ok) return requestOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  revalidatePath("/staff/discounts")
  return { status: "done" }
}

// Grant, or refuse with a reason. A retried click repeats the same decision,
// which the database takes as already done.
export async function decideDiscountAction(
  leadId: string,
  requestId: string,
  decision: "grant" | "refuse",
  reason: string | null,
): Promise<DiscountOutcome> {
  const doing = decision === "refuse" ? "refuse" : "grant"
  if (typeof leadId !== "string" || typeof requestId !== "string") return decideOutcome("not-found", doing)
  if (decision !== "grant" && decision !== "refuse") return decideOutcome("invalid", doing)
  if (decision === "refuse" && typeof reason !== "string") return decideOutcome("invalid", doing)

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canDecideDiscount(staff.data.permissions)) return decideOutcome("forbidden", doing)

  const result = await decideDiscount(
    supabase,
    requestId,
    decision === "grant" ? { decision: "grant" } : { decision: "refuse", reason: reason ?? "" },
  )
  if (!result.ok) return decideOutcome(result.error, doing)
  revalidatePath(`/staff/leads/${leadId}`)
  revalidatePath("/staff/discounts")
  return { status: "done" }
}
