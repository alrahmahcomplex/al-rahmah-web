import type { SupabaseClient } from "@supabase/supabase-js"

import { emailInUseMessage } from "@/lib/email-in-use"
import { RESERVED_PERMISSIONS, type Permission } from "@/lib/permissions"
import { roleTemplate, templateLinks } from "@/lib/role-templates"

import { recordAction } from "./audit"
import type { Result } from "./result"

// ---------------------------------------------------------------------------
// Refusals. The database refuses a write with a stable code as the error
// message and the names its sentence needs as JSON in the detail. This is the
// one place a code becomes the sentence a person reads.
// ---------------------------------------------------------------------------

export type RefusalCode =
  | "not_permitted"
  | "forbidden"
  | "own_role"
  | "own_account"
  | "role_retired"
  | "retired_role_on_reactivate"
  | "same_role"
  | "already_active"
  | "already_deactivated"
  | "name_required"
  | "not_found"
  | "role_not_retired"
  | "manages_itself"
  | "unknown_template"
  | "role_has_active_holders"
  | "duplicate_role_name"
  | "role_name_required"
  | "unknown_permission"
  | "already_staff"
  | "email_in_use"
  | "email_invalid"
  | "invite_deactivated"
  | "already_joined"
  | "invite_rate_limited"
  | "invite_not_sent"
  | "reset_deactivated"
  | "reset_not_joined"
  | "reset_rate_limited"
  | "reset_not_sent"
  | "unavailable"

export type Refusal = { code: RefusalCode; message: string }

type RefusalNames = { name?: string; role?: string; names?: string[]; email?: string; active?: boolean }

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" })

const MESSAGES: Record<RefusalCode, (names: RefusalNames) => string> = {
  not_permitted: ({ role }) =>
    role ? `Your role, ${role}, doesn't manage any staff.` : "Your role doesn't manage any staff.",
  forbidden: () =>
    "Your role can't make that change. Only the Super Admin changes roles, and you manage only the staff in the roles your role manages.",
  own_role: () => "You can't change your own role. The Super Admin, or someone whose role manages yours, has to do it.",
  own_account: () => "You can't deactivate yourself.",
  role_retired: ({ role }) => `"${role}" is retired, so nobody can be given it.`,
  retired_role_on_reactivate: ({ name, role }) =>
    `${name}'s role "${role}" was retired. Give them a current role first, then reactivate.`,
  same_role: ({ name, role }) => `${name} already holds ${role}.`,
  already_active: ({ name }) => `${name} is already active.`,
  already_deactivated: ({ name }) => `${name} is already deactivated.`,
  name_required: () => "Enter the person's full name.",
  not_found: () => "That staff member or role no longer exists. Reload the page and try again.",
  role_not_retired: ({ role }) => `${role} is already a current role.`,
  unknown_template: () => "That template no longer exists. Reload the page and try again.",
  manages_itself: ({ role }) => `${role} can't manage its own staff: its holders would manage each other.`,
  role_has_active_holders: ({ role, names = [] }) =>
    `${role} is still held by ${LIST.format(names)}. Move them to another role first.`,
  duplicate_role_name: ({ role }) => `A role called "${role}" already exists.`,
  role_name_required: () => "Enter a name for the role.",
  unknown_permission: () => "That permission no longer exists. Reload the page and try again.",
  already_staff: ({ email, name, active }) =>
    active
      ? `${email} already belongs to ${name}.`
      : `${email} already belongs to ${name}. Reactivate them instead of inviting again.`,
  // Held by someone the caller can't see: staff outside their managed set,
  // the Super Admin, a Marketing Agent or another sign-in. Nothing more is said.
  email_in_use: ({ email }) => emailInUseMessage(email ?? "This email"),
  email_invalid: () => "Enter a valid email address.",
  invite_deactivated: ({ name }) => `${name} is deactivated. Reactivate them before resending the invite.`,
  already_joined: ({ name }) => `${name} has already joined and signs in with their own password.`,
  invite_rate_limited: () => "Too many emails have gone out in the last hour. Try resending the invite later.",
  invite_not_sent: () => "The invite email could not be sent.",
  reset_deactivated: ({ name }) => `${name} is deactivated. Reactivate them before sending a reset link.`,
  reset_not_joined: ({ name }) => `${name} hasn't joined yet. Use Resend invite instead.`,
  // The database's hourly budget, or Supabase's own email limit.
  reset_rate_limited: () => "Too many emails have gone out in the last hour. Try sending the reset link later.",
  reset_not_sent: () => "The reset email could not be sent.",
  unavailable: () => "The change could not be saved. Try again in a moment.",
}

export function refusal(code: RefusalCode, names: RefusalNames = {}): Refusal {
  return { code, message: MESSAGES[code](names) }
}

// Codes that come from the invite email, not the database.
const SEND_CODES = new Set<RefusalCode>(["invite_rate_limited", "invite_not_sent", "reset_not_sent", "unavailable"])

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

// A new role, blank or from a template: its permissions, the roles it
// manages and the roles that manage it, all in one step.
export type NewRole = {
  permissions?: readonly Permission[]
  manages?: readonly string[]
  managedBy?: readonly string[]
}

export function createRole(
  supabase: SupabaseClient,
  name: string,
  { permissions = [], manages = [], managedBy = [] }: NewRole = {},
) {
  return write<RoleNames>(supabase, "create_role", { name, permissions, manages, managed_by: managedBy })
}

export function reactivateRole(supabase: SupabaseClient, roleId: string) {
  return write<RoleNames>(supabase, "reactivate_role", { role_id: roleId })
}

// Adds `managedRoleId` to the role's managed set, or takes it out.
export function setRoleManages(supabase: SupabaseClient, roleId: string, managedRoleId: string, manages: boolean) {
  return write<RoleNames>(supabase, "set_role_manages", { role_id: roleId, managed_role_id: managedRoleId, manages })
}

// A role from a template (lib/role-templates.ts), or blank without one. From
// a template it takes the template's permissions, manages the current roles
// its template manages, and joins the managed set of every current role
// whose template manages it. The database checks that the caller is the
// Super Admin.
export async function createRoleFromTemplate(
  supabase: SupabaseClient,
  name: string,
  templateName: string | null,
): Promise<Result<RoleNames, Refusal>> {
  if (!templateName) return createRole(supabase, name)
  const template = roleTemplate(templateName)
  if (!template) return { ok: false, error: refusal("unknown_template") }

  const { data, error } = await supabase.from("roles").select("id, name, retired")
  if (error) {
    console.error("Could not read the roles to link a new role", error)
    return { ok: false, error: refusal("unavailable") }
  }
  return createRole(supabase, name, { permissions: template.permissions, ...templateLinks(template, data ?? []) })
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
  const invited = await write<InvitedNames>(supabase, "resendable_invite", { staff_id: staffId })
  if (!invited.ok) return invited

  const failure = await sendAndRecord(supabase, send, invited.data, redirectTo)
  return failure ? { ok: false, error: failure } : invited
}

// A Manager's "Send reset link" (#265) for an active staff member who has
// joined. The database checks the Managed set, counts the send against the
// public hourly budget and records the password_reset_sent Action event, all
// before the email goes out, so no reset leaves without its event.
export async function sendResetLink(
  supabase: SupabaseClient,
  send: SendInvite,
  staffId: string,
  hourlyBudget: number,
  redirectTo: string,
): Promise<Result<InvitedNames, Refusal>> {
  const target = await write<InvitedNames>(supabase, "prepare_staff_reset", { staff_id: staffId, hourly_budget: hourlyBudget })
  if (!target.ok) return target

  const { error } = await send(target.data.email, redirectTo)
  if (!error) return target
  if (error.code === "over_email_send_rate_limit") return { ok: false, error: refusal("reset_rate_limited") }
  console.error("The reset email could not be sent", error)
  return { ok: false, error: refusal("reset_not_sent") }
}

// ---------------------------------------------------------------------------
// Reads for the Staff and roles screen.
// ---------------------------------------------------------------------------

// The migration-made role (#237). No reader returns it; the history names it.
export const SUPER_ADMIN_ROLE_ID = "5a000000-0000-4000-8000-000000000001"

export type PermissionOption = { name: Permission; label: string }

export type RoleSummary = {
  id: string
  name: string
  permissions: Permission[]
  retired: boolean
  activeHolders: number
  // The role's managed set: the roles whose staff its holders manage.
  manages: string[]
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
  // Every name the caller may read, by staff id, for the history's actors:
  // the staff above plus the signed-in Super Admin's own record, which the
  // list leaves out.
  actorNames?: ReadonlyMap<string, string>
  // Every managed-set pair, switched on or off, by its id, so the history
  // can name both roles when a pair is switched.
  managedPairs?: ReadonlyMap<string, ManagedPair>
}

export type ManagedPair = { roleId: string; managedRoleId: string }

type RoleRow = { id: string; name: string; permissions: Permission[]; retired: boolean }
type StaffRow = { id: string; full_name: string; email: string; role_id: string; active: boolean }

export async function getStaffAndRoles(supabase: SupabaseClient): Promise<Result<StaffAndRoles, "unavailable">> {
  const [permissions, roles, staff, invited, managed] = await Promise.all([
    supabase.from("permissions").select("name, label").order("position"),
    supabase.from("roles").select("id, name, permissions, retired").order("retired").order("name"),
    // Row security returns the staff the caller manages, and their own record.
    supabase.from("staff_members").select("id, full_name, email, role_id, active").order("full_name"),
    supabase.rpc("invited_staff_members"),
    supabase.from("role_managed_roles").select("id, role_id, managed_role_id, active"),
  ])
  const error = permissions.error ?? roles.error ?? staff.error ?? invited.error ?? managed.error
  if (error) {
    console.error("Could not read staff and roles", error)
    return { ok: false, error: "unavailable" }
  }

  // The database never returns the Super Admin role (#237). The Super Admin
  // still reads their own staff record, on that role, so the list leaves out
  // anyone whose role it did not return.
  const roleRows = (roles.data ?? []) as RoleRow[]
  const readable = (staff.data ?? []) as StaffRow[]
  const staffRows = readable.filter((s) => roleRows.some((role) => role.id === s.role_id))
  const invitedIds = new Set((invited.data ?? []) as string[])
  const pairs = (managed.data ?? []) as { id: string; role_id: string; managed_role_id: string; active: boolean }[]
  return {
    ok: true,
    data: {
      permissions: ((permissions.data ?? []) as PermissionOption[]).filter((p) => !RESERVED_PERMISSIONS.includes(p.name)),
      roles: roleRows.map((role) => ({
        ...role,
        activeHolders: staffRows.filter((s) => s.role_id === role.id && s.active).length,
        manages: pairs.filter((pair) => pair.active && pair.role_id === role.id).map((pair) => pair.managed_role_id),
      })),
      staff: staffRows.map((s) => ({
        id: s.id,
        name: s.full_name,
        email: s.email,
        roleId: s.role_id,
        active: s.active,
        invited: invitedIds.has(s.id),
      })),
      actorNames: new Map(readable.map((s) => [s.id, s.full_name])),
      managedPairs: new Map(pairs.map((pair) => [pair.id, { roleId: pair.role_id, managedRoleId: pair.managed_role_id }])),
    },
  }
}

// ---------------------------------------------------------------------------
// History: staff-and-role changes and invites, newest first, as sentences.
// The audit log is the Super Admin's alone (#237); anyone else reads no rows.
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
  managedPairs?: ReadonlyMap<string, ManagedPair>
}

const ACTOR_KINDS: Record<string, string> = {
  system: "System",
  public_form: "Admission form",
  workbook_import: "Workbook import",
}

// Bookkeeping columns that say nothing on a newly created row.
const HIDDEN_ON_INSERT = new Set(["id", "created_at", "notices_seen_at"])

// The school is in Tanzania, so times read in East Africa Time.
const HISTORY_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

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
    case "notices_seen_at":
      return HISTORY_TIME.format(new Date(String(value)))
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
  const isPair = row.table_name === "role_managed_roles"
  const subject = isStaff
    ? (lookup.staffNames.get(row.row_id ?? "") ?? "a staff member")
    : isRole
      ? (lookup.roleNames.get(row.row_id ?? "") ?? "a role")
      : null

  const newValues = row.new_values ?? {}
  const oldValues = row.old_values ?? {}
  const invitee =
    (row.action === "invite_sent" || row.action === "password_reset_sent") && newValues.staff_member_id
      ? (lookup.staffNames.get(String(newValues.staff_member_id)) ?? null)
      : null

  let summary: string
  if (isPair) {
    // A managed-set pair names both roles when it is made. An update carries
    // only the switch, so the roles come from the pair itself, by row id.
    const on = newValues.active !== false
    const pair = lookup.managedPairs?.get(row.row_id ?? "")
    const manager = lookup.roleNames.get(String(newValues.role_id ?? pair?.roleId ?? "")) ?? "a role"
    const managed = lookup.roleNames.get(String(newValues.managed_role_id ?? pair?.managedRoleId ?? "")) ?? "a role"
    if (row.action === "insert") summary = on ? `let ${manager} manage the staff in ${managed}` : `recorded that ${manager} doesn't manage ${managed}`
    else summary = on ? `let ${manager} manage the staff in ${managed} again` : `stopped ${manager} managing the staff in ${managed}`
  } else if (row.action === "insert") summary = isStaff ? `added ${subject} to staff` : isRole ? `created the role ${subject}` : `added a ${row.table_name} row`
  else if (row.action === "update") summary = isRole ? `changed the role ${subject}` : isStaff ? `changed ${subject}` : `changed a ${row.table_name} row`
  else if (row.action === "invite_sent") summary = invitee ? `sent an invite to ${invitee}` : "sent an invite"
  else if (row.action === "password_reset_sent") summary = invitee ? `sent a password reset link to ${invitee}` : "sent a password reset link"
  else if (row.action === "hosted_reset") summary = "reset the database before launch"
  else if (row.action === "roles_became_templates") summary = "turned the seeded roles into templates"
  else summary = row.action

  // The reset record's values are counts per table for the owner's checklist,
  // not field changes.
  const changes = Object.keys(row.action === "hosted_reset" || isPair ? {} : newValues)
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
): Promise<Result<HistoryEntry[], "forbidden" | "unavailable">> {
  // Row security would answer anyone else with no rows; say forbidden instead.
  const allowed = await supabase.rpc("has_permission", { permission: "audit.view" })
  if (allowed.error) {
    console.error("Could not check the permission to read the staff and roles history", allowed.error)
    return { ok: false, error: "unavailable" }
  }
  if (allowed.data !== true) return { ok: false, error: "forbidden" }

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
    staffNames: staffAndRoles.actorNames ?? new Map(staffAndRoles.staff.map((s) => [s.id, s.name])),
    // The Super Admin role is left out of the roles; its own entries still name it.
    roleNames: new Map([[SUPER_ADMIN_ROLE_ID, "Super Admin"], ...staffAndRoles.roles.map((r): [string, string] => [r.id, r.name])]),
    permissionLabels: new Map(staffAndRoles.permissions.map((p) => [p.name, p.label])),
    managedPairs: staffAndRoles.managedPairs,
  }
  return { ok: true, data: ((data ?? []) as AuditRow[]).map((row) => describeAuditRow(row, lookup)) }
}

// ---------------------------------------------------------------------------
// Sign-in notices (ADR 4): changes to the signed-in person's own role or
// active state that someone else made since they last dismissed them.
// ---------------------------------------------------------------------------

export type NoticeRow = {
  id: number
  created_at: string
  actor_kind: string
  actor_name: string | null
  // Empty when the role didn't change.
  old_role: string | null
  new_role: string | null
  // Empty when the active state didn't change.
  active: boolean | null
}

export type Notice = { id: number; at: string; message: string }

const NOTICE_ACTORS: Record<string, string> = {
  system: "The system",
  public_form: "The admission form",
  workbook_import: "The workbook import",
}

// The school is in Tanzania, so dates read in East Africa Time.
const NOTICE_DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Africa/Dar_es_Salaam" })

export function describeNotice(row: NoticeRow): string {
  const actor =
    row.actor_name ?? NOTICE_ACTORS[row.actor_kind] ?? (row.actor_kind === "staff" ? "A former staff member" : row.actor_kind)

  const changes: string[] = []
  if (row.old_role !== null || row.new_role !== null) {
    changes.push(`changed your role from ${row.old_role ?? "a removed role"} to ${row.new_role ?? "a removed role"}`)
  }
  if (row.active !== null) changes.push(row.active ? "reactivated your account" : "deactivated your account")

  return `${actor} ${changes.join(" and ")} on ${NOTICE_DATE.format(new Date(row.created_at))}.`
}

export async function getMyNotices(supabase: SupabaseClient): Promise<Result<Notice[], "unavailable">> {
  const { data, error } = await supabase.rpc("my_notices")
  if (error) {
    console.error("Could not read the signed-in staff member's notices", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as NoticeRow[]).map((row) => ({ id: row.id, at: row.created_at, message: describeNotice(row) })),
  }
}

// Dismisses through the newest notice the person was shown, so one that
// arrived since stays for next time.
export async function dismissNotices(supabase: SupabaseClient, through: number): Promise<Result<null, "unavailable">> {
  const { error } = await supabase.rpc("dismiss_notices", { through })
  if (error) {
    console.error("Could not dismiss notices", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: null }
}
