import type { Permission } from "@/lib/permissions"

// The roles the Super Admin creates in one step on Staff and roles (#241).
// A template is only a starting point: the role it makes is ordinary data
// the Super Admin edits afterwards. `manages` names other templates; on
// creation it becomes the role's managed set, the roles whose staff its
// holders may invite, deactivate, reactivate and move between those roles.
// supabase/seeds/00_base.sql recreates the first three locally with these
// permissions; tests/unit/role-templates.test.ts and
// tests/integration/roles-v2.test.ts hold the two together.
export type RoleTemplate = {
  name: string
  // What the role is for, shown beside the template when choosing one.
  summary: string
  permissions: readonly Permission[]
  manages: readonly string[]
}

const ADMISSIONS_STAFF: readonly Permission[] = [
  "follow_ups.record",
  "group_links.manage",
  "interviews.record",
  "leads.close",
  "leads.create",
  "leads.decline",
  "leads.edit",
  "leads.view",
  "payments.view",
  "results.send",
  "visits.record",
]

const ACCOUNTANT: readonly Permission[] = [
  "interview_payments.record",
  "leads.view",
  "payments.record",
  "payments.view",
]

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: "Admissions Staff",
    summary: "Front desk and admissions work on leads, visits, interviews and follow-ups.",
    permissions: ADMISSIONS_STAFF,
    manages: [],
  },
  {
    name: "Admissions Manager",
    summary: "Runs admissions, approves reopenings, discounts and agents, and manages Admissions Staff.",
    permissions: [
      ...ADMISSIONS_STAFF,
      "academic_years.manage",
      "agents.approve",
      "discount_codes.manage",
      "discounts.approve",
      "leads.export",
      "leads.import",
      "lifecycle.intervene",
      "reopenings.approve",
      "reports.view",
    ],
    manages: ["Admissions Staff"],
  },
  {
    name: "Accountant",
    summary: "Records interview fees and school-fee payments.",
    permissions: ACCOUNTANT,
    manages: [],
  },
  {
    name: "Head Accountant",
    summary: "An Accountant who also manages the Accountants and sees Reports.",
    permissions: [...ACCOUNTANT, "reports.view"],
    manages: ["Accountant"],
  },
  {
    name: "Administrator",
    summary: "Manages Admissions Managers and Head Accountants. Reads leads, payments and Reports; changes neither.",
    permissions: ["leads.view", "payments.view", "reports.view"],
    manages: ["Admissions Manager", "Head Accountant"],
  },
]

export function roleTemplate(name: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((template) => template.name === name)
}

type NamedRole = { id: string; name: string; retired: boolean }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// The current roles a role made from `template` should manage, and the
// current roles whose own template manages it, matched by name. Creating
// Admissions Staff after the Admissions Manager still puts it in the
// Manager's set, so the order the Super Admin creates roles in doesn't
// matter. A role renamed away from its template's name is not matched.
export function templateLinks(
  template: RoleTemplate,
  roles: readonly NamedRole[],
): { manages: string[]; managedBy: string[] } {
  const current = roles.filter((role) => !role.retired)
  const manages = current
    .filter((role) => template.manages.some((name) => same(name, role.name)))
    .map((role) => role.id)
  const managedBy = current
    .filter((role) =>
      ROLE_TEMPLATES.some((other) => same(other.name, role.name) && other.manages.includes(template.name)),
    )
    .map((role) => role.id)
  return { manages, managedBy }
}
