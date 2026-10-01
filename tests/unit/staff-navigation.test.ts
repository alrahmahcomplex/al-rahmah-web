import { describe, expect, it } from "vitest"

import { navFor, STAFF_NAV, type StaffNavEntry } from "@/app/staff/navigation"

const ENTRIES: StaffNavEntry[] = [
  { href: "/staff/roles", label: "Staff and roles", permission: "staff.administer" },
  { href: "/staff/leads", label: "Leads", permission: "leads.view" },
]

describe("navFor", () => {
  it("shows only the entries whose permission the staff member holds, in order", () => {
    expect(navFor(["leads.view", "payments.view"], ENTRIES)).toEqual([ENTRIES[1]])
    expect(navFor(["staff.administer", "leads.view"], ENTRIES)).toEqual(ENTRIES)
  })

  it("shows nothing to a role with no matching permission", () => {
    expect(navFor([], ENTRIES)).toEqual([])
  })

  it("shows an entry that accepts any of several permissions to a holder of any one of them", () => {
    const either: StaffNavEntry = { href: "/staff/either", label: "Either", permission: ["payments.view", "leads.view"] }
    expect(navFor(["payments.view"], [either])).toEqual([either])
    expect(navFor(["leads.view"], [either])).toEqual([either])
    expect(navFor(["staff.administer"], [either])).toEqual([])
  })
})

describe("the staff navigation", () => {
  it("shows Check-in to anyone who may view leads, and to no one else", () => {
    const checkIn = STAFF_NAV.find((entry) => entry.label === "Check-in")
    expect(checkIn).toEqual({ href: "/staff/check-in", label: "Check-in", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(checkIn)
    expect(navFor(["payments.view"])).not.toContain(checkIn)
  })

  it("shows Leads to anyone who may view leads, and to no one else", () => {
    const leads = STAFF_NAV.find((entry) => entry.label === "Leads")
    expect(leads).toEqual({ href: "/staff/leads", label: "Leads", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(leads)
    expect(navFor(["payments.view"])).not.toContain(leads)
  })
})
