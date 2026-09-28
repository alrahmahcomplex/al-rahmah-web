"use server"

import { revalidatePath } from "next/cache"

import type { Result } from "@/lib/services/result"
import {
  assignRole,
  correctStaffName,
  deactivateStaff,
  reactivateStaff,
  type Refusal,
} from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

// What the pane shows in its callout after a change.
export type ChangeOutcome = { ok: boolean; message: string }

// The names are only for the confirmation sentence. The database decides
// what happens from the ids alone.
async function settle(result: Result<null, Refusal>, success: string): Promise<ChangeOutcome> {
  // A refusal often means the screen was out of date (someone else changed
  // the person first), so it refreshes either way.
  revalidatePath("/staff/roles")
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, message: success }
}

export async function moveStaffMember(staffId: string, roleId: string, names: { name: string; role: string }) {
  const supabase = await createClient()
  return settle(await assignRole(supabase, staffId, roleId), `Moved ${names.name} to ${names.role}.`)
}

export async function deactivateStaffMember(staffId: string, name: string) {
  const supabase = await createClient()
  return settle(await deactivateStaff(supabase, staffId), `Deactivated ${name}.`)
}

export async function reactivateStaffMember(staffId: string, name: string) {
  const supabase = await createClient()
  return settle(await reactivateStaff(supabase, staffId), `Reactivated ${name}.`)
}

export async function correctStaffMemberName(staffId: string, fullName: string) {
  const supabase = await createClient()
  return settle(await correctStaffName(supabase, staffId, fullName), `Name corrected to ${String(fullName).trim()}.`)
}
