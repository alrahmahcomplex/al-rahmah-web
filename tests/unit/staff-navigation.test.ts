import { describe, expect, it } from "vitest"

import {
  currentNavHref,
  groupNav,
  NAV_GROUPS,
  navFor,
  STAFF_HOME,
  STAFF_NAV,
  type StaffNavEntry,
  type StaffNavGroup,
} from "@/app/staff/navigation"

const ENTRIES: StaffNavEntry[] = [
  { href: "/staff/roles", label: "Staff and roles", group: "Admin", icon: STAFF_HOME.icon, permission: "staff.administer" },
  { href: "/staff/leads", label: "Leads", group: "Admissions", icon: STAFF_HOME.icon, permission: "leads.view" },
]

// The seeded roles' permissions, from the roles migration.
const ADMISSIONS_STAFF = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "visits.record",
  "interviews.record",
  "results.send",
  "follow_ups.record",
  "leads.decline",
  "leads.close",
  "payments.view",
] as const
const ADMISSIONS_MANAGER = [
  ...ADMISSIONS_STAFF,
  "reopenings.approve",
  "lifecycle.intervene",
  "agents.approve",
  "discounts.approve",
  "academic_years.manage",
  "staff.administer",
] as const
const ACCOUNTANT = ["leads.view", "interview_payments.record", "payments.view", "payments.record"] as const

describe("navFor", () => {
  it("shows only the entries whose permission the staff member holds, in order", () => {
    expect(navFor(["leads.view", "payments.view"], ENTRIES)).toEqual([ENTRIES[1]])
    expect(navFor(["staff.administer", "leads.view"], ENTRIES)).toEqual(ENTRIES)
  })

  it("shows nothing to a role with no matching permission", () => {
    expect(navFor([], ENTRIES)).toEqual([])
  })

  it("shows an entry that accepts any of several permissions to a holder of any one of them", () => {
    const either: StaffNavEntry = {
      href: "/staff/either",
      label: "Either",
      group: "Money",
      icon: STAFF_HOME.icon,
      permission: ["payments.view", "leads.view"],
    }
    expect(navFor(["payments.view"], [either])).toEqual([either])
    expect(navFor(["leads.view"], [either])).toEqual([either])
    expect(navFor(["staff.administer"], [either])).toEqual([])
  })
})

describe("the staff navigation", () => {
  it("puts every entry in a group with an icon", () => {
    for (const entry of STAFF_NAV) {
      expect(NAV_GROUPS).toContain(entry.group)
      expect(entry.icon).toBeTypeOf("object")
    }
    expect(STAFF_HOME).toMatchObject({ href: "/staff", label: "Today", group: "Front desk" })
  })

  it("shows Check-in to anyone who may view leads, and to no one else", () => {
    const checkIn = STAFF_NAV.find((entry) => entry.label === "Check-in")
    expect(checkIn).toMatchObject({ href: "/staff/check-in", group: "Front desk", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(checkIn)
    expect(navFor(["payments.view"])).not.toContain(checkIn)
  })

  it("shows Register a student to those who may both create leads and record visits, as the page needs", () => {
    const register = STAFF_NAV.find((entry) => entry.label === "Register a student")
    expect(register).toMatchObject({
      href: "/staff/check-in/new",
      group: "Front desk",
      permission: "leads.create",
      alsoNeeds: "visits.record",
    })
    expect(navFor(["leads.create", "visits.record"])).toContain(register)
    expect(navFor(["leads.create"])).not.toContain(register)
    expect(navFor(["leads.view", "visits.record"])).not.toContain(register)
  })

  it("shows Fee schedule to anyone who may view payments or manage academic years", () => {
    const fees = STAFF_NAV.find((entry) => entry.label === "Fee schedule")
    expect(fees).toMatchObject({ href: "/staff/fees", group: "Money" })
    expect(navFor(["payments.view"])).toContain(fees)
    expect(navFor(["academic_years.manage"])).toContain(fees)
    expect(navFor(["leads.view", "payments.record"])).not.toContain(fees)
  })

  it("shows Leads to anyone who may view leads, and to no one else", () => {
    const leads = STAFF_NAV.find((entry) => entry.label === "Leads")
    expect(leads).toMatchObject({ href: "/staff/leads", group: "Admissions", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(leads)
    expect(navFor(["payments.view"])).not.toContain(leads)
  })

  it("shows Audit only to the Super Admin, the one holder of audit.view (#237)", () => {
    const audit = STAFF_NAV.find((entry) => entry.label === "Audit")
    expect(audit).toMatchObject({ href: "/staff/audit", group: "Admin", permission: "audit.view" })
    expect(navFor([...ADMISSIONS_MANAGER])).not.toContain(audit)
    expect(navFor(["audit.view"])).toContain(audit)
  })

  it("shows Re-applications to anyone who may view leads, and to no one else", () => {
    const reApplications = STAFF_NAV.find((entry) => entry.label === "Re-applications")
    expect(reApplications).toMatchObject({ href: "/staff/re-applications", group: "Admissions", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(reApplications)
    expect(navFor(["payments.view"])).not.toContain(reApplications)
  })

  it("shows Reopening requests to approvers who may view leads, where they decide", () => {
    const reopenings = STAFF_NAV.find((entry) => entry.label === "Reopening requests")
    expect(reopenings).toMatchObject({
      href: "/staff/reopenings",
      group: "Admin",
      permission: "reopenings.approve",
      alsoNeeds: "leads.view",
    })
    expect(navFor(["leads.view", "reopenings.approve"])).toContain(reopenings)
    expect(navFor(["reopenings.approve"])).not.toContain(reopenings)
    // Admissions Staff and the Accountant.
    expect(navFor(["leads.view", "leads.create", "leads.edit", "leads.decline", "leads.close"])).not.toContain(reopenings)
    expect(navFor(["leads.view", "payments.view", "payments.record"])).not.toContain(reopenings)
  })

  it("shows Reports, the old dashboard, to staff who administer the staff side and may view leads", () => {
    const reports = STAFF_NAV.find((entry) => entry.label === "Reports")
    expect(reports).toMatchObject({ href: "/staff/reports", group: "Admin", permission: "staff.administer", alsoNeeds: "leads.view" })
    expect(navFor(ADMISSIONS_MANAGER)).toContain(reports)
    expect(navFor(["staff.administer"])).not.toContain(reports)
    expect(navFor(ADMISSIONS_STAFF)).not.toContain(reports)
    expect(navFor(ACCOUNTANT)).not.toContain(reports)
  })
})

describe("groupNav", () => {
  const names = (groups: { name: StaffNavGroup }[]) => groups.map((group) => group.name)

  it("keeps the sidebar's group order and each group's entries in the order given", () => {
    const grouped = groupNav([STAFF_HOME, ...navFor(ADMISSIONS_MANAGER)])
    expect(names(grouped)).toEqual(["Front desk", "Admissions", "Referrals", "Money", "Admin"])
    expect(grouped[0].entries.map((entry) => entry.label)).toEqual(["Today", "Check-in", "Register a student"])
    expect(grouped[4].entries.map((entry) => entry.label)).toEqual(["Discount requests", "Reopening requests", "Reports", "Staff and roles"])
  })

  it("leaves out a group with nothing in it", () => {
    expect(names(groupNav([STAFF_HOME, ...navFor(ADMISSIONS_STAFF)]))).toEqual(["Front desk", "Admissions", "Referrals", "Money"])
    expect(groupNav(navFor(ADMISSIONS_STAFF)).find((group) => group.name === "Money")?.entries.map((entry) => entry.label)).toEqual([
      "Fee schedule",
    ])
    expect(names(groupNav(navFor(["payments.view"])))).toEqual(["Money"])
    expect(groupNav([])).toEqual([])
  })

  it("gives the Accountant, who may view leads, the lead screens as well as Money", () => {
    expect(names(groupNav([STAFF_HOME, ...navFor(ACCOUNTANT)]))).toEqual(["Front desk", "Admissions", "Referrals", "Money"])
  })
})

describe("currentNavHref", () => {
  const hrefs = ["/staff", "/staff/check-in", "/staff/check-in/new", "/staff/leads"]

  it("picks the entry whose href is the page or its nearest parent", () => {
    expect(currentNavHref("/staff/check-in", hrefs)).toBe("/staff/check-in")
    expect(currentNavHref("/staff/check-in/new", hrefs)).toBe("/staff/check-in/new")
    expect(currentNavHref("/staff/leads/1ead0000-0000-4000-8000-000000000001", hrefs)).toBe("/staff/leads")
    expect(currentNavHref("/staff/leads/x/history", hrefs)).toBe("/staff/leads")
  })

  it("does not take a prefix for a parent", () => {
    expect(currentNavHref("/staff/check-inn", hrefs)).toBeUndefined()
    expect(currentNavHref("/staff/leadsx", hrefs)).toBeUndefined()
  })

  it("marks the home only on the home itself", () => {
    expect(currentNavHref("/staff", hrefs)).toBe("/staff")
    expect(currentNavHref("/staff/somewhere-else", hrefs)).toBeUndefined()
  })
})
