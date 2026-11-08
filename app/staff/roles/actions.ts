"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import type { Permission } from "@/lib/permissions"
import type { Result } from "@/lib/services/result"
import {
  assignRole,
  correctStaffName,
  createRoleFromTemplate,
  deactivateStaff,
  inviteStaff,
  reactivateRole,
  reactivateStaff,
  resendInvite,
  sendResetLink,
  renameRole,
  retireRole,
  setRoleManages,
  setRolePermission,
  type Refusal,
  type RoleNames,
} from "@/lib/services/staff-admin"
import { RESET_PATH } from "@/lib/password-reset"
import { readLinkLimits } from "@/lib/services/password-link-requests"
import { inviteSender, passwordResetSender } from "@/utils/supabase/admin"
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
export async function addRole(name: string, templateName: string | null): Promise<ChangeOutcome & { roleId?: string }> {
  const supabase = await createClient()
  const result = await createRoleFromTemplate(supabase, name, templateName)
  const outcome = await settle<RoleNames>(result, ({ role }) =>
    templateName ? `Created ${role} from the ${templateName} template.` : `Created ${role}. Tick what it can do.`,
  )
  return result.ok ? { ...outcome, roleId: result.data.id } : outcome
}

export async function reactivateRoleNow(roleId: string) {
  const supabase = await createClient()
  return settle<RoleNames>(await reactivateRole(supabase, roleId), ({ role }) => `${role} is a current role again.`)
}

// Adds a role to this role's managed set, or takes it out.
export async function setManagedRole(roleId: string, managedRoleId: string, manages: boolean) {
  const supabase = await createClient()
  return settle<RoleNames>(await setRoleManages(supabase, roleId, managedRoleId, manages), ({ role }) =>
    manages ? `${role} now manages the staff in another role.` : `${role} no longer manages the staff in that role.`,
  )
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

// Where the invite email links back to: /auth/confirm on the site the Manager
// is using, so a Preview's invites come back to that Preview. Next.js has
// already checked that a Server Action's Origin matches its Host. Supabase
// sends any address missing from its allow-list to the Site URL instead.
async function siteOrigin() {
  const request = await headers()
  const host = request.get("x-forwarded-host") ?? request.get("host")
  return request.get("origin") ?? `${request.get("x-forwarded-proto") ?? "https"}://${host}`
}

async function confirmUrl() {
  return `${await siteOrigin()}/auth/confirm`
}

// The record is kept even when the email fails, so the outcome says which
// happened and the person shows as Invited with Resend invite beside them.
export async function inviteStaffMember(
  roleId: string,
  fullName: string,
  email: string,
): Promise<ChangeOutcome & { created: boolean }> {
  const supabase = await createClient()
  const result = await inviteStaff(supabase, inviteSender(), { fullName, email, roleId }, await confirmUrl())
  revalidatePath("/staff/roles")
  if (!result.ok) return { ok: false, created: false, message: result.error.message }

  const { name, role, email: sentTo, ...invitation } = result.data
  if (invitation.sent) {
    return { ok: true, created: true, message: `Invited ${name} to ${role}. The email is on its way to ${sentTo}.` }
  }
  return {
    ok: false,
    created: true,
    message: `${name} was added to ${role}, but the invite wasn't sent. ${invitation.failure.message} Use Resend invite to try again.`,
  }
}

export async function resendStaffInvite(staffId: string) {
  const supabase = await createClient()
  return settle(
    await resendInvite(supabase, inviteSender(), staffId, await confirmUrl()),
    ({ name, email }) => `Sent ${name} a new invite at ${email}. The earlier link no longer works.`,
  )
}

// "Send reset link" (#265): Supabase's recovery email, landing on the shared
// reset page. It counts against the public hourly budget, so a Manager can't
// use up the emails invites need either.
export async function sendStaffResetLink(staffId: string) {
  const supabase = await createClient()
  return settle(
    await sendResetLink(supabase, passwordResetSender(), staffId, readLinkLimits().hourlyBudget, `${await siteOrigin()}${RESET_PATH}`),
    ({ name, email }) => `Sent ${name} a reset link at ${email}. It works once, for 24 hours.`,
  )
}
