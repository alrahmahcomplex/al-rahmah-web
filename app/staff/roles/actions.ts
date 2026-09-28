"use server"

import { revalidatePath } from "next/cache"

import type { Result } from "@/lib/services/result"
import {
  assignRole,
  correctStaffName,
  deactivateStaff,
  reactivateStaff,
  type Refusal,
  type StaffNames,
} from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

// What the pane shows in its callout after a change.
export type ChangeOutcome = { ok: boolean; message: string }

// The confirmation uses the names the database returns after the change,
// so it matches what the refreshed pane shows.
async function settle(
  result: Result<StaffNames, Refusal>,
  success: (names: StaffNames) => string,
): Promise<ChangeOutcome> {
  // A refusal often means the screen was out of date (someone else changed
  // the person first), so it refreshes either way.
  revalidatePath("/staff/roles")
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, message: success(result.data) }
}

export async function moveStaffMember(staffId: string, roleId: string) {
  const supabase = await createClient()
  return settle(await assignRole(supabase, staffId, roleId), ({ name, role }) => `Moved ${name} to ${role}.`)
}

export async function deactivateStaffMember(staffId: string) {
  const supabase = await createClient()
  return settle(await deactivateStaff(supabase, staffId), ({ name }) => `Deactivated ${name}.`)
}

export async function reactivateStaffMember(staffId: string) {
  const supabase = await createClient()
  return settle(await reactivateStaff(supabase, staffId), ({ name }) => `Reactivated ${name}.`)
}

export async function correctStaffMemberName(staffId: string, fullName: string) {
  const supabase = await createClient()
  return settle(await correctStaffName(supabase, staffId, fullName), ({ name }) => `Name corrected to ${name}.`)
}
