import { impliedChanges, type Permission } from "@/lib/permissions"
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

export const shownPermissions = (saved: readonly Permission[], draft: Draft) => shown(saved, draft.permissions)
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
  const wanted = <T,>(order: readonly T[], saved: readonly T[], map: ReadonlyMap<T, boolean>, on: boolean) =>
    order.filter((item) => map.get(item) === on && saved.includes(item) !== on)
  return {
    addPermissions: wanted(permissionOrder, savedPermissions, draft.permissions, true),
    removePermissions: wanted(permissionOrder, savedPermissions, draft.permissions, false),
    addManaged: wanted(managedOrder, savedManaged, draft.managed, true),
    removeManaged: wanted(managedOrder, savedManaged, draft.managed, false),
  }
}

export function changeCount(changes: RoleChanges): number {
  return changes.addPermissions.length + changes.removePermissions.length + changes.addManaged.length + changes.removeManaged.length
}
