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
  "staff.administer",
  "group_links.manage",
  // The full audit history. No role can hold it: only the Super Admin, who
  // answers true for every permission, has it (#237).
  "audit.view",
] as const

// Never offered on a role, so the Roles tab leaves it out.
export const RESERVED_PERMISSIONS: readonly Permission[] = ["audit.view"]

export type Permission = (typeof PERMISSIONS)[number]
