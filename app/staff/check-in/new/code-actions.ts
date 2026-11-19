"use server"

import type { CodeOption } from "@/components/guided-form/code-list"
import { listUsableDiscountCodes } from "@/lib/services/referral"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { codeOptionOf } from "./code-options"

// The Discount code list on Register Students: every code that takes money
// off today, for staff who may put a code on an application. The database
// checks leads.edit again.

export type CodeListOutcome = { status: "ok"; codes: CodeOption[] } | { status: "unavailable" }

export async function listCodesToPick(): Promise<CodeListOutcome> {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return { status: "unavailable" }

  const listed = await listUsableDiscountCodes(supabase)
  if (!listed.ok) return { status: "unavailable" }
  return { status: "ok", codes: listed.data.map(codeOptionOf) }
}
