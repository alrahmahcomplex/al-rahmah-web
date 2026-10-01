import type { Permission } from "@/lib/permissions"

// An entry needs one permission, or any one of several.
export type StaffNavEntry = { href: string; label: string; permission: Permission | readonly Permission[] }

// Every area of the staff side, each shown only to holders of the permission
// it needs. Later slices add their entries here.
export const STAFF_NAV: readonly StaffNavEntry[] = [
  { href: "/staff/check-in", label: "Check-in", permission: "leads.view" },
  { href: "/staff/leads", label: "Leads", permission: "leads.view" },
  { href: "/staff/fees", label: "Fee schedule", permission: ["payments.view", "academic_years.manage"] },
  { href: "/staff/roles", label: "Staff and roles", permission: "staff.administer" },
]

export function navFor(
  permissions: readonly Permission[],
  entries: readonly StaffNavEntry[] = STAFF_NAV,
): StaffNavEntry[] {
  return entries.filter((entry) => {
    const accepted: readonly Permission[] = typeof entry.permission === "string" ? [entry.permission] : entry.permission
    return accepted.some((permission) => permissions.includes(permission))
  })
}
