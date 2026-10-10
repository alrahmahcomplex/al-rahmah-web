"use server"

import { revalidatePath } from "next/cache"

import { applyReApplicationField } from "@/lib/services/re-application-apply"
import type { ReApplicationField } from "@/lib/services/re-applications"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import type { CorrectionOutcome } from "../../leads/[id]/correction-outcome"
import { FIELD_LABELS } from "../format"
import { applyOutcome } from "./apply-outcome"

const isString = (value: unknown) => typeof value === "string"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

// Applies one value the family sent, read from the re-application itself.
// `children` are the ids of every lead on the contact when the page opened:
// the ones the staff member was told a contact change reaches.
export async function applyAction(
  reApplicationId: string,
  field: ReApplicationField,
  children: string[],
): Promise<CorrectionOutcome> {
  if (
    !isString(reApplicationId) ||
    !isString(field) ||
    !Object.hasOwn(FIELD_LABELS, field) ||
    !Array.isArray(children) ||
    !children.every(isString)
  ) {
    return { status: "refused", field: null, message: "Some details could not be read. Reload the page and try again." }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return applyOutcome({ kind: "forbidden" })

  const result = await applyReApplicationField(supabase, reApplicationId, field, children)
  if (!result.ok) return applyOutcome(result.error)
  // The lead, every child on a changed contact, and this comparison change.
  revalidatePath("/staff", "layout")
  return { status: "saved" }
}
