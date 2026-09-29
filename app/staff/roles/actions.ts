"use server"

import { revalidatePath } from "next/cache"

import type { Permission } from "@/lib/permissions"
import type { Result } from "@/lib/services/result"
import {
  assignRole,
  correctStaffName,
  createRole,
  deactivateStaff,
  reactivateStaff,
  renameRole,
  retireRole,
  setRolePermission,
  type Refusal,
  type RoleNames,
} from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

// What the pane shows in its callout after a change.
export type ChangeOutcome = { ok: boolean; message: string }

// The confirmation uses the names the database returns after the change,
// so it matches what the refreshed pane shows.
async function settle<T>(result: Result<T, Refusal>, success: (names: T) => string): Promise<ChangeOutcome> {
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

// A new role opens in the pane, so the outcome carries its id.
export async function addRole(name: string): Promise<ChangeOutcome & { roleId?: string }> {
  const supabase = await createClient()
  const result = await createRole(supabase, name)
  const outcome = await settle<RoleNames>(result, ({ role }) => `Created ${role}. Tick what it can do.`)
  return result.ok ? { ...outcome, roleId: result.data.id } : outcome
}

export async function renameRoleTo(roleId: string, name: string) {
  const supabase = await createClient()
  return settle<RoleNames>(await renameRole(supabase, roleId, name), ({ role }) => `Renamed the role to ${role}.`)
}

export async function setPermission(roleId: string, permission: Permission, granted: boolean) {
  const supabase = await createClient()
  return settle<RoleNames>(await setRolePermission(supabase, roleId, permission, granted), ({ role }) =>
    granted ? `Added a permission to ${role}.` : `Removed a permission from ${role}.`,
  )
}

export async function retireRoleNow(roleId: string) {
  const supabase = await createClient()
  return settle<RoleNames>(await retireRole(supabase, roleId), ({ role }) => `Retired ${role}. It stays in history.`)
}
