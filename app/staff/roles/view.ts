import { refusal, type RoleSummary, type StaffAndRoles } from "@/lib/services/staff-admin"

// What the screen can already tell is blocked, worked out on the server from
// the same data the database checks. The database still has the last word;
// these only disable a control early and say why beside it.

export type RoleOption = { id: string; name: string; administers: boolean }

export type PersonStatus = "Active" | "Invited" | "Deactivated"

export type PersonView = {
  id: string
  name: string
  email: string
  active: boolean
  // Invited until they accept their invite and set a password.
  status: PersonStatus
  canResendInvite: boolean
  isYou: boolean
  // Holds "Administer staff and roles" right now, so moving them off it or
  // deactivating them asks for confirmation first.
  administers: boolean
  moveTargets: RoleOption[]
  moveBlocked: string | null
  deactivateBlocked: string | null
  reactivateBlocked: string | null
}

export type RoleView = RoleSummary & {
  isYours: boolean
  administers: boolean
  // Open to renaming, retiring and ticking permissions. When it is not, the
  // subtitle says why.
  editable: boolean
  retireBlocked: string | null
  // Why the invite box is closed, when it is.
  inviteBlocked: string | null
  subtitle: string
  people: PersonView[]
}

const administers = (role: Pick<RoleSummary, "permissions" | "retired">) =>
  !role.retired && role.permissions.includes("staff.administer")

function subtitleFor(role: RoleSummary, isYours: boolean): string {
  if (isYours) return "This is your role. Another Manager has to change it."
  if (role.retired) return "Retired. Kept for history."
  if (administers(role)) return "Only a reviewed update to the system can change this role."
  return "Changes apply to everyone in this role immediately."
}

export function roleView(data: StaffAndRoles, roleId: string, viewerId: string): RoleView | null {
  const role = data.roles.find((r) => r.id === roleId)
  if (!role) return null

  const viewerRoleId = data.staff.find((s) => s.id === viewerId)?.roleId
  const isYours = viewerRoleId === role.id
  const current = data.roles.filter((r) => !r.retired)

  const people = data.staff
    .filter((s) => s.roleId === role.id)
    .map((s): PersonView => {
      const isYou = s.id === viewerId
      const moveTargets = current
        .filter((r) => r.id !== role.id)
        .map((r) => ({ id: r.id, name: r.name, administers: administers(r) }))

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        active: s.active,
        status: !s.active ? "Deactivated" : s.invited ? "Invited" : "Active",
        canResendInvite: s.active && s.invited,
        isYou,
        administers: s.active && administers(role),
        moveTargets,
        moveBlocked: isYou
          ? refusal("own_role").message
          : moveTargets.length === 0
            ? "There is no other current role to move them to."
            : null,
        deactivateBlocked: isYou ? refusal("own_account").message : null,
        reactivateBlocked: role.retired
          ? refusal("retired_role_on_reactivate", { name: s.name, role: role.name }).message
          : null,
      }
    })
    // Active people first, each group in name order.
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  // The same order the database checks in: the role you hold, then retired,
  // then frozen because it can administer staff (retired or not).
  const editable = !isYours && !role.retired && !role.permissions.includes("staff.administer")
  const holders = people.filter((p) => p.active).map((p) => p.name)

  return {
    ...role,
    isYours,
    administers: administers(role),
    editable,
    retireBlocked:
      editable && holders.length > 0 ? refusal("role_has_active_holders", { role: role.name, names: holders }).message : null,
    inviteBlocked: role.retired ? refusal("role_retired", { role: role.name }).message : null,
    subtitle: subtitleFor(role, isYours),
    people,
  }
}
