import { describe, expect, it } from "vitest"

import { navFor, type StaffNavEntry } from "@/app/staff/navigation"

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
})
