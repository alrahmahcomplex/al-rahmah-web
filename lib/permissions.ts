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
] as const

export type Permission = (typeof PERMISSIONS)[number]
