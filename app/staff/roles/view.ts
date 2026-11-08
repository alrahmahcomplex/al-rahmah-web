import { refusal, type RoleSummary, type StaffAndRoles } from "@/lib/services/staff-admin"

// What the screen can already tell is blocked, worked out on the server from
// the same data the database checks. The database still has the last word;
// these only disable or leave out a control and say why beside it.
//
// Three kinds of viewer reach the screen (#241): the Super Admin, who
// changes every role and manages everyone; a holder of a role with a
// managed set, who manages the staff in those roles and reads the roles;
// and nobody else, whom the page refuses.

export type Viewer = {
  id: string
  superAdmin: boolean
  managedRoleIds: readonly string[]
}

export type RoleOption = { id: string; name: string; managesStaff: boolean }

export type PersonStatus = "Active" | "Invited" | "Deactivated"

export type PersonView = {
  id: string
  name: string
  email: string
  active: boolean
  // Invited until they accept their invite and set a password.
  status: PersonStatus
  canResendInvite: boolean
  // Active and joined (#265). The database checks the Managed set again.
  canSendReset: boolean
  isYou: boolean
  // Manages other staff right now, so moving them to a role that manages
  // nobody, or deactivating them, asks for confirmation first.
  managesStaff: boolean
  moveTargets: RoleOption[]
  moveBlocked: string | null
  deactivateBlocked: string | null
  reactivateBlocked: string | null
}

// A role the Super Admin may add to this role's managed set or take out.
export type ManagedOption = {
  id: string
  name: string
  checked: boolean
  retired: boolean
}

export type RoleView = RoleSummary & {
  isYours: boolean
  // The viewer changes roles: shows rename, retire or reactivate, the
  // permission checkboxes and the managed set. Only the Super Admin does.
  canEditRoles: boolean
  // Open to renaming, retiring and ticking permissions right now.
  editable: boolean
  // The viewer manages this role's staff: shows the people and the invite.
  managed: boolean
  // This role's holders manage other staff.
  managesStaff: boolean
  managesNames: string[]
  managedOptions: ManagedOption[]
  retireBlocked: string | null
  // Why the invite box is closed, when it is.
  inviteBlocked: string | null
  subtitle: string
  people: PersonView[]
}

export function managesRole(viewer: Viewer, roleId: string): boolean {
  return viewer.superAdmin || viewer.managedRoleIds.includes(roleId)
}

const managesOthers = (role: Pick<RoleSummary, "manages" | "retired">) => !role.retired && role.manages.length > 0

function subtitleFor(role: RoleSummary, viewer: Viewer, isYours: boolean, managed: boolean): string {
  if (viewer.superAdmin) {
    if (role.retired) return "Retired. Kept for history. Reactivate it to give it to anyone again."
    return "Changes apply to everyone in this role immediately."
  }
  if (managed) return "You manage the staff in this role. Only the Super Admin changes what it can do."
  if (isYours) return "This is your role. Only the Super Admin changes it."
  return "Your role doesn't manage the staff in this role. Only the Super Admin changes roles."
}

export function roleView(data: StaffAndRoles, roleId: string, viewer: Viewer): RoleView | null {
  const role = data.roles.find((r) => r.id === roleId)
  if (!role) return null

  const viewerRoleId = data.staff.find((s) => s.id === viewer.id)?.roleId
  const isYours = viewerRoleId === role.id
  const managed = managesRole(viewer, role.id)
  const current = data.roles.filter((r) => !r.retired)
  const names = new Map(data.roles.map((r) => [r.id, r.name]))

  const people = !managed
    ? []
    : data.staff
        .filter((s) => s.roleId === role.id)
        .map((s): PersonView => {
          const isYou = s.id === viewer.id
          // Moves stay inside the viewer's managed set.
          const moveTargets = current
            .filter((r) => r.id !== role.id && managesRole(viewer, r.id))
            .map((r) => ({
              id: r.id,
              name: r.name,
              managesStaff: managesOthers(r),
            }))

          return {
            id: s.id,
            name: s.name,
            email: s.email,
            active: s.active,
            status: !s.active ? "Deactivated" : s.invited ? "Invited" : "Active",
            canResendInvite: s.active && s.invited,
            // Someone resetting their own password uses the sign-in page.
            canSendReset: s.active && !s.invited && !isYou,
            isYou,
            managesStaff: s.active && managesOthers(role),
            moveTargets,
            moveBlocked: isYou
              ? refusal("own_role").message
              : moveTargets.length === 0
                ? "There is no other current role you manage to move them to."
                : null,
            deactivateBlocked: isYou ? refusal("own_account").message : null,
            reactivateBlocked: role.retired
              ? refusal("retired_role_on_reactivate", {
                  name: s.name,
                  role: role.name,
                }).message
              : null,
          }
        })
        // Active people first, each group in name order.
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  const editable = viewer.superAdmin && !role.retired
  const holders = people.filter((p) => p.active).map((p) => p.name)

  return {
    ...role,
    isYours,
    canEditRoles: viewer.superAdmin,
    editable,
    managed,
    managesStaff: managesOthers(role),
    managesNames: role.manages.map((id) => names.get(id) ?? "A removed role"),
    // Every other current role, and any retired one still in the set so it
    // can be taken out.
    managedOptions: viewer.superAdmin
      ? data.roles
          .filter((r) => r.id !== role.id && (!r.retired || role.manages.includes(r.id)))
          .map((r) => ({
            id: r.id,
            name: r.name,
            checked: role.manages.includes(r.id),
            retired: r.retired,
          }))
      : [],
    retireBlocked:
      editable && holders.length > 0
        ? refusal("role_has_active_holders", {
            role: role.name,
            names: holders,
          }).message
        : null,
    inviteBlocked: role.retired ? refusal("role_retired", { role: role.name }).message : null,
    subtitle: subtitleFor(role, viewer, isYours, managed),
    people,
  }
}
