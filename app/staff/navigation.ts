import type { Permission } from "@/lib/permissions"

// An entry needs one permission, or any one of several, and also
// `alsoNeeds` when its page shows nothing without it.
export type StaffNavEntry = {
  href: string
  label: string
  permission: Permission | readonly Permission[]
  alsoNeeds?: Permission
}

// Every area of the staff side, each shown only to holders of the permission
// it needs. Later slices add their entries here.
export const STAFF_NAV: readonly StaffNavEntry[] = [
  { href: "/staff/check-in", label: "Check-in", permission: "leads.view" },
  { href: "/staff/leads", label: "Leads", permission: "leads.view" },
  { href: "/staff/follow-ups", label: "Follow-ups", permission: "leads.view" },
  { href: "/staff/interviews", label: "Interviews", permission: "leads.view" },
  { href: "/staff/agents", label: "Marketing Agents", permission: "leads.view" },
  { href: "/staff/re-applications", label: "Re-applications", permission: "leads.view" },
  { href: "/staff/fees", label: "Fee schedule", permission: ["payments.view", "academic_years.manage"] },
  { href: "/staff/seats", label: "Seats", permission: "academic_years.manage", alsoNeeds: "payments.view" },
  { href: "/staff/roles", label: "Staff and roles", permission: "staff.administer" },
]

export function navFor(
  permissions: readonly Permission[],
  entries: readonly StaffNavEntry[] = STAFF_NAV,
): StaffNavEntry[] {
  return entries.filter((entry) => {
    const accepted: readonly Permission[] = typeof entry.permission === "string" ? [entry.permission] : entry.permission
    if (entry.alsoNeeds && !permissions.includes(entry.alsoNeeds)) return false
    return accepted.some((permission) => permissions.includes(permission))
  })
}
