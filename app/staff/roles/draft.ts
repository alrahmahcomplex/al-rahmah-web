import { impliedChanges, PERMISSION_NEEDS, type Permission } from "@/lib/permissions"
import type { RoleChanges } from "@/lib/services/staff-admin"

// The Roles page's unsaved changes: each box that differs from what's
// saved, and the value it now shows. Selecting a box changes only this;
// Save changes sends it. Kept apart from what's saved, so a refresh after
// someone else's save keeps these changes on top of theirs.
export type Draft = {
  permissions: ReadonlyMap<Permission, boolean>
  managed: ReadonlyMap<string, boolean>
}

export const EMPTY_DRAFT: Draft = { permissions: new Map(), managed: new Map() }

function shown<T>(saved: readonly T[], draft: ReadonlyMap<T, boolean>): T[] {
  const kept = saved.filter((item) => draft.get(item) !== false)
  const added = [...draft].filter(([item, on]) => on && !saved.includes(item)).map(([item]) => item)
  return [...kept, ...added]
}

// The permissions the boxes show, with the pairs kept together the way the
// database will on save. Usually selecting already did it; this matters
// when someone else's save changed what's saved underneath the draft: a
// shown permission whose needed one is no longer saved shows it selected,
// unless the draft clears the needed one, which then clears it too.
export function shownPermissions(saved: readonly Permission[], draft: Draft): Permission[] {
  const result = shown(saved, draft.permissions)
  for (const [dependent, needed] of Object.entries(PERMISSION_NEEDS) as [Permission, Permission][]) {
    if (!result.includes(dependent) || result.includes(needed)) continue
    if (draft.permissions.get(needed) === false) result.splice(result.indexOf(dependent), 1)
    else result.push(needed)
  }
  return result
}

export const shownManaged = (saved: readonly string[], draft: Draft) => shown(saved, draft.managed)

function set<T>(saved: readonly T[], draft: ReadonlyMap<T, boolean>, items: readonly T[], on: boolean): Map<T, boolean> {
  const next = new Map(draft)
  for (const item of items) {
    // Back to what's saved: no longer a change.
    if (saved.includes(item) === on) next.delete(item)
    else next.set(item, on)
  }
  return next
}

// Selecting a permission also selects the one it needs; clearing one clears
// those that need it, as the database does on save.
export function selectPermission(saved: readonly Permission[], draft: Draft, permission: Permission, on: boolean): Draft {
  const implied = impliedChanges(shownPermissions(saved, draft), permission, on)
  return { ...draft, permissions: set(saved, draft.permissions, [permission, ...implied], on) }
}

export function selectManaged(saved: readonly string[], draft: Draft, roleId: string, on: boolean): Draft {
  return { ...draft, managed: set(saved, draft.managed, [roleId], on) }
}

// What Save changes sends, in the order the boxes are listed. A change
// someone else's save already made is no longer a change.
export function draftChanges(
  savedPermissions: readonly Permission[],
  permissionOrder: readonly Permission[],
  savedManaged: readonly string[],
  managedOrder: readonly string[],
  draft: Draft,
): RoleChanges {
  // What the boxes show against what's saved, so Save sends exactly what the
  // screen shows.
  const differ = <T,>(order: readonly T[], saved: readonly T[], showing: readonly T[], on: boolean) =>
    order.filter((item) => showing.includes(item) === on && saved.includes(item) !== on)
  const permissions = shownPermissions(savedPermissions, draft)
  const managed = shownManaged(savedManaged, draft)
  return {
    addPermissions: differ(permissionOrder, savedPermissions, permissions, true),
    removePermissions: differ(permissionOrder, savedPermissions, permissions, false),
    addManaged: differ(managedOrder, savedManaged, managed, true),
    removeManaged: differ(managedOrder, savedManaged, managed, false),
  }
}

export function changeCount(changes: RoleChanges): number {
  return changes.addPermissions.length + changes.removePermissions.length + changes.addManaged.length + changes.removeManaged.length
}
