// The fixed permission list from CONTEXT.md. The database holds the same
// names in `public.permissions`; tests/integration/staff-rbac.test.ts fails if the two
// drift apart.
export const PERMISSIONS = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "visits.record",
  "interviews.record",
  "interview_payments.record",
  "results.send",
  "follow_ups.record",
  "leads.decline",
  "leads.close",
  "reopenings.approve",
  "lifecycle.intervene",
  "agents.approve",
  "payments.view",
  "payments.record",
  "discounts.approve",
  "academic_years.manage",
  "group_links.manage",
  // The full audit history. No role can hold it: only the Super Admin, who
  // answers true for every permission, has it (#237).
  "audit.view",
  // The Reports page (#241), once shown to holders of the retired
  // staff.administer.
  "reports.view",
] as const

// Never offered on a role, so the Roles tab leaves it out.
export const RESERVED_PERMISSIONS: readonly Permission[] = ["audit.view"]

export type Permission = (typeof PERMISSIONS)[number]

// A permission that is useless without another (#244): every Reports count is
// answered only under leads.view. The database keeps each pair together
// (supabase/migrations/20261130990700_reports_imply_leads.sql); the role
// screen uses this to tick and untick them together and say why.
export const PERMISSION_NEEDS: Readonly<Partial<Record<Permission, Permission>>> = {
  "reports.view": "leads.view",
}

// The other permissions that change when `permission` is ticked or unticked
// on a role holding `held`: ticking adds what it needs, unticking takes away
// what needs it. Matches the database trigger.
export function impliedChanges(held: readonly string[], permission: Permission, granted: boolean): Permission[] {
  if (granted) {
    const needed = PERMISSION_NEEDS[permission]
    return needed && !held.includes(needed) ? [needed] : []
  }
  return (Object.entries(PERMISSION_NEEDS) as [Permission, Permission][])
    .filter(([dependent, needed]) => needed === permission && held.includes(dependent))
    .map(([dependent]) => dependent)
}
