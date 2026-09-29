import type { SupabaseClient } from "@supabase/supabase-js"

import type { Permission } from "@/lib/permissions"

import { recordAction } from "./audit"
import type { Result } from "./result"

// ---------------------------------------------------------------------------
// Refusals. The database refuses a write with a stable code as the error
// message and the names its sentence needs as JSON in the detail. This is the
// one place a code becomes the sentence a person reads.
// ---------------------------------------------------------------------------

export type RefusalCode =
  | "not_permitted"
  | "own_role"
  | "own_account"
  | "role_retired"
  | "retired_role_on_reactivate"
  | "no_administrator_left"
  | "same_role"
  | "already_active"
  | "already_deactivated"
  | "name_required"
  | "not_found"
  | "role_you_hold"
  | "administer_role_frozen"
  | "role_has_active_holders"
  | "duplicate_role_name"
  | "role_name_required"
  | "unknown_permission"
  | "already_staff"
  | "email_invalid"
  | "invite_deactivated"
  | "already_joined"
  | "invite_rate_limited"
  | "invite_not_sent"
  | "unavailable"

export type Refusal = { code: RefusalCode; message: string }

type RefusalNames = { name?: string; role?: string; names?: string[]; email?: string; active?: boolean }

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" })

export const ADMINISTER_LABEL = "Administer staff and roles"

const MESSAGES: Record<RefusalCode, (names: RefusalNames) => string> = {
  not_permitted: ({ role }) =>
    role
      ? `Your role, ${role}, doesn't include "${ADMINISTER_LABEL}".`
      : `Your role doesn't include "${ADMINISTER_LABEL}".`,
  own_role: () => "You can't change your own role. Another Manager has to do it.",
  own_account: () => "You can't deactivate yourself.",
  role_retired: ({ role }) => `"${role}" is retired, so nobody can be given it.`,
  retired_role_on_reactivate: ({ name, role }) =>
    `${name}'s role "${role}" was retired. Give them a current role first, then reactivate.`,
  no_administrator_left: () => "This would leave no one able to manage staff, so it isn't allowed.",
  same_role: ({ name, role }) => `${name} already holds ${role}.`,
  already_active: ({ name }) => `${name} is already active.`,
  already_deactivated: ({ name }) => `${name} is already deactivated.`,
  name_required: () => "Enter the person's full name.",
  not_found: () => "That staff member or role no longer exists. Reload the page and try again.",
  role_you_hold: () => "You can't edit the role you hold. Another Manager has to do it.",
  administer_role_frozen: () => "Roles that can administer staff change only through a reviewed update to the system.",
  role_has_active_holders: ({ role, names = [] }) =>
    `${role} is still held by ${LIST.format(names)}. Move them to another role first.`,
  duplicate_role_name: ({ role }) => `A role called "${role}" already exists.`,
  role_name_required: () => "Enter a name for the role.",
  unknown_permission: () => "That permission no longer exists. Reload the page and try again.",
  already_staff: ({ email, name, active }) =>
    active
      ? `${email} already belongs to ${name}.`
      : `${email} already belongs to ${name}. Reactivate them instead of inviting again.`,
  email_invalid: () => "Enter a valid email address.",
  invite_deactivated: ({ name }) => `${name} is deactivated. Reactivate them before resending the invite.`,
  already_joined: ({ name }) => `${name} has already joined and signs in with their own password.`,
  invite_rate_limited: () => "Too many emails have gone out in the last hour. Try resending the invite later.",
  invite_not_sent: () => "The invite email could not be sent.",
  unavailable: () => "The change could not be saved. Try again in a moment.",
}

export function refusal(code: RefusalCode, names: RefusalNames = {}): Refusal {
  return { code, message: MESSAGES[code](names) }
}

// Codes that come from the invite email, not the database.
const SEND_CODES = new Set<RefusalCode>(["invite_rate_limited", "invite_not_sent", "unavailable"])

const DATABASE_CODES = new Set<string>(
  (Object.keys(MESSAGES) as RefusalCode[]).filter((code) => !SEND_CODES.has(code)),
)

// Turns a Supabase error from a write function into a refusal. Anything that
// is not one of the known codes is reported as unavailable, never shown raw.
export function refusalFromError(error: { message: string; details?: string | null }): Refusal {
  if (!DATABASE_CODES.has(error.message)) {
    console.error("Staff admin write failed", error)
    return refusal("unavailable")
  }

  let names: RefusalNames = {}
  try {
    names = error.details ? (JSON.parse(error.details) as RefusalNames) : {}
  } catch {
    names = {}
  }
  return refusal(error.message as RefusalCode, names)
}

// The person's name and role as they stand after a change.
export type StaffNames = { name: string; role: string }

// The role's id and name as they stand after a change.
export type RoleNames = { id: string; role: string }

async function write<T = StaffNames>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Result<T, Refusal>> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { ok: false, error: refusalFromError(error) }
  return { ok: true, data: data as T }
}

// ---------------------------------------------------------------------------
// Writes. Each runs on the signed-in staff member's session, so the database
// checks their permission and the audit log names them.
// ---------------------------------------------------------------------------

export function assignRole(supabase: SupabaseClient, staffId: string, roleId: string) {
  return write(supabase, "assign_staff_role", { staff_id: staffId, role_id: roleId })
}

export function deactivateStaff(supabase: SupabaseClient, staffId: string) {
  return write(supabase, "deactivate_staff_member", { staff_id: staffId })
}

export function reactivateStaff(supabase: SupabaseClient, staffId: string) {
  return write(supabase, "reactivate_staff_member", { staff_id: staffId })
}

export function correctStaffName(supabase: SupabaseClient, staffId: string, fullName: string) {
  return write(supabase, "correct_staff_name", { staff_id: staffId, full_name: fullName })
}

// A new role starts with no permissions.
export function createRole(supabase: SupabaseClient, name: string) {
  return write<RoleNames>(supabase, "create_role", { name })
}

export function renameRole(supabase: SupabaseClient, roleId: string, name: string) {
  return write<RoleNames>(supabase, "rename_role", { role_id: roleId, name })
}

// Ticks or unticks one permission, so two Managers changing different
// permissions at once never undo each other.
export function setRolePermission(supabase: SupabaseClient, roleId: string, permission: Permission, granted: boolean) {
  return write<RoleNames>(supabase, "set_role_permission", { role_id: roleId, permission, granted })
}

export function retireRole(supabase: SupabaseClient, roleId: string) {
  return write<RoleNames>(supabase, "retire_role", { role_id: roleId })
}

// ---------------------------------------------------------------------------
// Invites. The record is written on the caller's session, like every other
// change; only the email goes out with the secret key, through `send`.
// ---------------------------------------------------------------------------

// Sends Supabase's invite email to the address, linking back to redirectTo.
// Built from the secret key on the server: see utils/supabase/admin.ts.
export type SendInvite = (
  email: string,
  redirectTo: string,
) => Promise<{ error: { message: string; status?: number; code?: string } | null }>

export type InviteDetails = { fullName: string; email: string; roleId: string }

export type InvitedNames = StaffNames & { id: string; email: string }

// The record always exists once the database accepts it. The email may still
// fail, and then the screen offers Resend invite.
export type Invitation = InvitedNames & ({ sent: true } | { sent: false; failure: Refusal })

async function requireAdministrator(supabase: SupabaseClient): Promise<Refusal | null> {
  const { data, error } = await supabase.rpc("has_permission", { permission: "staff.administer" })
  if (error) {
    console.error("Could not check the permission to invite staff", error)
    return refusal("unavailable")
  }
  return data === true ? null : refusal("not_permitted")
}

// What stopped the email. A confirmed account means they joined already.
function sendFailure(error: { code?: string }, names: RefusalNames): Refusal {
  if (error.code === "email_exists") return refusal("already_joined", names)
  if (error.code === "over_email_send_rate_limit") return refusal("invite_rate_limited")
  console.error("The invite email could not be sent", error)
  return refusal("invite_not_sent")
}

async function sendAndRecord(
  supabase: SupabaseClient,
  send: SendInvite,
  invited: InvitedNames,
  redirectTo: string,
): Promise<Refusal | null> {
  const { error } = await send(invited.email, redirectTo)
  if (error) return sendFailure(error, invited)

  // The email has gone, so a failure to record it is logged, not reported
  // to the Manager as a failed invite.
  const recorded = await recordAction(supabase, "invite_sent", null, {
    staff_member_id: invited.id,
    email: invited.email,
  })
  if (!recorded.ok) console.error("Sent an invite but could not record it", invited.id, recorded.error)
  return null
}

export async function inviteStaff(
  supabase: SupabaseClient,
  send: SendInvite,
  details: InviteDetails,
  redirectTo: string,
): Promise<Result<Invitation, Refusal>> {
  const refused = await requireAdministrator(supabase)
  if (refused) return { ok: false, error: refused }

  const created = await write<InvitedNames>(supabase, "invite_staff_member", {
    full_name: details.fullName,
    email: details.email,
    role_id: details.roleId,
  })
  if (!created.ok) return created

  const failure = await sendAndRecord(supabase, send, created.data, redirectTo)
  return { ok: true, data: failure ? { ...created.data, sent: false, failure } : { ...created.data, sent: true } }
}

// Sends a fresh invite while the person has not yet joined. It replaces the
// earlier link.
export async function resendInvite(
  supabase: SupabaseClient,
  send: SendInvite,
  staffId: string,
  redirectTo: string,
): Promise<Result<InvitedNames, Refusal>> {
  const refused = await requireAdministrator(supabase)
  if (refused) return { ok: false, error: refused }

  const invited = await write<InvitedNames>(supabase, "resendable_invite", { staff_id: staffId })
  if (!invited.ok) return invited

  const failure = await sendAndRecord(supabase, send, invited.data, redirectTo)
  return failure ? { ok: false, error: failure } : invited
}

// ---------------------------------------------------------------------------
// Reads for the Staff and roles screen.
// ---------------------------------------------------------------------------

export type PermissionOption = { name: Permission; label: string }

export type RoleSummary = {
  id: string
  name: string
  permissions: Permission[]
  retired: boolean
  activeHolders: number
}

export type StaffSummary = {
  id: string
  name: string
  email: string
  roleId: string
  active: boolean
  // Has not yet accepted their invite.
  invited: boolean
}

export type StaffAndRoles = {
  permissions: PermissionOption[]
  roles: RoleSummary[]
  staff: StaffSummary[]
}

type RoleRow = { id: string; name: string; permissions: Permission[]; retired: boolean }
type StaffRow = { id: string; full_name: string; email: string; role_id: string; active: boolean }

export async function getStaffAndRoles(supabase: SupabaseClient): Promise<Result<StaffAndRoles, "unavailable">> {
  const [permissions, roles, staff, invited] = await Promise.all([
    supabase.from("permissions").select("name, label").order("position"),
    supabase.from("roles").select("id, name, permissions, retired").order("retired").order("name"),
    supabase.from("staff_members").select("id, full_name, email, role_id, active").order("full_name"),
    supabase.rpc("invited_staff_members"),
  ])
  const error = permissions.error ?? roles.error ?? staff.error ?? invited.error
  if (error) {
    console.error("Could not read staff and roles", error)
    return { ok: false, error: "unavailable" }
  }

  const staffRows = (staff.data ?? []) as StaffRow[]
  const invitedIds = new Set((invited.data ?? []) as string[])
  return {
    ok: true,
    data: {
      permissions: (permissions.data ?? []) as PermissionOption[],
      roles: ((roles.data ?? []) as RoleRow[]).map((role) => ({
        ...role,
        activeHolders: staffRows.filter((s) => s.role_id === role.id && s.active).length,
      })),
      staff: staffRows.map((s) => ({
        id: s.id,
        name: s.full_name,
        email: s.email,
        roleId: s.role_id,
        active: s.active,
        invited: invitedIds.has(s.id),
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// History: staff-and-role changes and invites, newest first, as sentences.
// Names are looked up when read, so a corrected name shows everywhere.
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: number
  table_name: string | null
  row_id: string | null
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  actor_kind: string
  actor_staff_id: string | null
  created_at: string
}

export type HistoryChange = { field: string; from: string | null; to: string | null }

export type HistoryEntry = {
  id: number
  at: string
  actor: string
  summary: string
  changes: HistoryChange[]
}

export type HistoryLookup = {
  staffNames: ReadonlyMap<string, string>
  roleNames: ReadonlyMap<string, string>
  permissionLabels: ReadonlyMap<string, string>
}

const ACTOR_KINDS: Record<string, string> = {
  system: "System",
  public_form: "Admission form",
  workbook_import: "Workbook import",
}

// Bookkeeping columns that say nothing on a newly created row.
const HIDDEN_ON_INSERT = new Set(["id", "created_at", "notices_seen_at"])

function raw(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

// How each known column reads. A column not listed here shows under its own
// name with its raw value, so nothing a later migration adds is ever hidden.
function describeField(key: string, value: unknown, lookup: HistoryLookup): HistoryChange["to"] {
  if (value === null || value === undefined) return null
  switch (key) {
    case "role_id":
      return lookup.roleNames.get(String(value)) ?? String(value)
    case "staff_member_id":
      return lookup.staffNames.get(String(value)) ?? String(value)
    case "active":
      return value ? "Active" : "Deactivated"
    case "retired":
      return value ? "Retired" : "Current"
    case "user_id":
      return "Linked"
    case "permissions":
      return Array.isArray(value)
        ? value.map((p) => lookup.permissionLabels.get(String(p)) ?? String(p)).join(", ") || "None"
        : raw(value)
    default:
      return raw(value)
  }
}

const FIELD_NAMES: Record<string, string> = {
  full_name: "name",
  name: "name",
  role_id: "role",
  staff_member_id: "staff member",
  active: "status",
  retired: "status",
  user_id: "account",
  notices_seen_at: "notices read",
}

export function describeAuditRow(row: AuditRow, lookup: HistoryLookup): HistoryEntry {
  const actor =
    row.actor_kind === "staff"
      ? (lookup.staffNames.get(row.actor_staff_id ?? "") ?? "A former staff member")
      : (ACTOR_KINDS[row.actor_kind] ?? row.actor_kind)

  const isStaff = row.table_name === "staff_members"
  const isRole = row.table_name === "roles"
  const subject = isStaff
    ? (lookup.staffNames.get(row.row_id ?? "") ?? "a staff member")
    : isRole
      ? (lookup.roleNames.get(row.row_id ?? "") ?? "a role")
      : null

  const newValues = row.new_values ?? {}
  const oldValues = row.old_values ?? {}
  const invitee =
    row.action === "invite_sent" && newValues.staff_member_id
      ? (lookup.staffNames.get(String(newValues.staff_member_id)) ?? null)
      : null

  let summary: string
  if (row.action === "insert") summary = isStaff ? `added ${subject} to staff` : isRole ? `created the role ${subject}` : `added a ${row.table_name} row`
  else if (row.action === "update") summary = isRole ? `changed the role ${subject}` : isStaff ? `changed ${subject}` : `changed a ${row.table_name} row`
  else if (row.action === "invite_sent") summary = invitee ? `sent an invite to ${invitee}` : "sent an invite"
  else summary = row.action

  const changes = Object.keys(newValues)
    .filter((key) => row.action !== "insert" || !HIDDEN_ON_INSERT.has(key))
    // The summary already names who an invite went to.
    .filter((key) => !(invitee && key === "staff_member_id"))
    .map((key) => ({
      field: FIELD_NAMES[key] ?? key,
      from: row.action === "update" ? describeField(key, oldValues[key], lookup) : null,
      to: describeField(key, newValues[key], lookup),
    }))

  return { id: row.id, at: row.created_at, actor, summary, changes }
}

export async function getStaffAdminHistory(
  supabase: SupabaseClient,
  staffAndRoles: StaffAndRoles,
  limit = 100,
): Promise<Result<HistoryEntry[], "unavailable">> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, table_name, row_id, action, old_values, new_values, actor_kind, actor_staff_id, created_at")
    .eq("scope", "staff_admin")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("Could not read the staff and roles history", error)
    return { ok: false, error: "unavailable" }
  }

  const lookup: HistoryLookup = {
    staffNames: new Map(staffAndRoles.staff.map((s) => [s.id, s.name])),
    roleNames: new Map(staffAndRoles.roles.map((r) => [r.id, r.name])),
    permissionLabels: new Map(staffAndRoles.permissions.map((p) => [p.name, p.label])),
  }
  return { ok: true, data: ((data ?? []) as AuditRow[]).map((row) => describeAuditRow(row, lookup)) }
}
