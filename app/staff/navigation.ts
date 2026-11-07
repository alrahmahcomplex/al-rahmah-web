import {
  ArmchairIcon,
  BadgePercentIcon,
  CalendarCheckIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  DoorOpenIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  PhoneIcon,
  RepeatIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"

import type { Permission } from "@/lib/permissions"

// The sidebar's groups, in the order they are shown. A group none of whose
// entries the staff member may see is not shown at all.
export const NAV_GROUPS = ["Front desk", "Admissions", "Referrals", "Money", "Admin"] as const
export type StaffNavGroup = (typeof NAV_GROUPS)[number]

// An entry needs one permission, or any one of several, and also
// `alsoNeeds` when its page shows nothing without it. Staff and roles needs
// no permission: it shows to the Super Admin and to holders of a role that
// manages other roles' staff (#241), marked `managesStaff`.
export type StaffNavEntry = {
  href: string
  label: string
  group: StaffNavGroup
  icon: LucideIcon
  alsoNeeds?: Permission
} & ({ permission: Permission | readonly Permission[]; managesStaff?: never } | { managesStaff: true; permission?: never })

// The staff home. Everyone signed in sees it, so it needs no permission and
// sits outside STAFF_NAV; the shell puts it first in Front desk.
export const STAFF_HOME = {
  href: "/staff",
  label: "Today",
  group: "Front desk",
  icon: CalendarCheckIcon,
} as const satisfies Omit<StaffNavEntry, "permission">

// Every area of the staff side, each shown only to holders of the permission
// it needs. Later slices add their entries here.
export const STAFF_NAV: readonly StaffNavEntry[] = [
  { href: "/staff/check-in", label: "Check-in", group: "Front desk", icon: DoorOpenIcon, permission: "leads.view" },
  {
    href: "/staff/check-in/new",
    label: "Register a student",
    group: "Front desk",
    icon: UserPlusIcon,
    permission: "leads.create",
    alsoNeeds: "visits.record",
  },
  { href: "/staff/leads", label: "Leads", group: "Admissions", icon: UsersIcon, permission: "leads.view" },
  { href: "/staff/interviews", label: "Interviews", group: "Admissions", icon: ClipboardCheckIcon, permission: "leads.view" },
  { href: "/staff/follow-ups", label: "Follow-ups", group: "Admissions", icon: PhoneIcon, permission: "leads.view" },
  { href: "/staff/re-applications", label: "Re-applications", group: "Admissions", icon: RepeatIcon, permission: "leads.view" },
  { href: "/staff/agents", label: "Marketing Agents", group: "Referrals", icon: MegaphoneIcon, permission: "leads.view" },
  { href: "/staff/group-links", label: "WhatsApp groups", group: "Referrals", icon: MessageCircleIcon, permission: "leads.view" },
  {
    href: "/staff/fees",
    label: "Fee schedule",
    group: "Money",
    icon: WalletIcon,
    permission: ["payments.view", "academic_years.manage"],
  },
  { href: "/staff/seats", label: "Seats", group: "Money", icon: ArmchairIcon, permission: "academic_years.manage", alsoNeeds: "payments.view" },
  { href: "/staff/discounts", label: "Discount requests", group: "Admin", icon: BadgePercentIcon, permission: "discounts.approve" },
  {
    href: "/staff/reopenings",
    label: "Reopening requests",
    group: "Admin",
    icon: RotateCcwIcon,
    permission: "reopenings.approve",
    alsoNeeds: "leads.view",
  },
  { href: "/staff/reports", label: "Reports", group: "Admin", icon: ChartColumnIcon, permission: "reports.view" },
  { href: "/staff/roles", label: "Staff and roles", group: "Admin", icon: ShieldCheckIcon, managesStaff: true },
  // The Super Admin's alone: no role can hold audit.view (#237).
  { href: "/staff/audit", label: "Audit", group: "Admin", icon: ScrollTextIcon, permission: "audit.view" },
]

export function navFor(
  permissions: readonly Permission[],
  entries: readonly StaffNavEntry[] = STAFF_NAV,
  { managesStaff = false }: { managesStaff?: boolean } = {},
): StaffNavEntry[] {
  return entries.filter((entry) => {
    if (entry.managesStaff) return managesStaff
    const accepted: readonly Permission[] = typeof entry.permission === "string" ? [entry.permission] : entry.permission
    if (entry.alsoNeeds && !permissions.includes(entry.alsoNeeds)) return false
    return accepted.some((permission) => permissions.includes(permission))
  })
}

// The entries by group, in NAV_GROUPS order and each group's entries in the
// order given, leaving out every group with nothing in it.
export function groupNav<T extends { group: StaffNavGroup }>(entries: readonly T[]): { name: StaffNavGroup; entries: T[] }[] {
  return NAV_GROUPS.map((name) => ({ name, entries: entries.filter((entry) => entry.group === name) })).filter(
    (group) => group.entries.length > 0,
  )
}

// The entry the page at `pathname` belongs to: the longest href that is the
// path or a parent of it, so /staff/check-in/new is Register a student rather
// than Check-in, and /staff/leads/<id> is Leads. The home is a parent of every
// staff page, so it counts only for itself.
export function currentNavHref(pathname: string, hrefs: readonly string[]): string | undefined {
  let current: string | undefined
  for (const href of hrefs) {
    const matches = href === STAFF_HOME.href ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
    if (matches && (current === undefined || href.length > current.length)) current = href
  }
  return current
}
