import { describe, expect, it } from "vitest"

import { childHref, relationshipLabel } from "@/app/staff/check-in/family"
import { familyRefusal } from "@/app/staff/check-in/outcome"

describe("the relationship as staff read it", () => {
  it("names Other with its description", () => {
    expect(relationshipLabel("Other", "Neighbour")).toBe("Other: Neighbour")
    expect(relationshipLabel("Father", null)).toBe("Father")
  })
})

describe("a refused Family lookup", () => {
  it("keeps staff on the parent step, naming the number that can't be read", () => {
    expect(familyRefusal({ kind: "invalid", field: "phone" })).toMatchObject({ status: "refused", field: "phone" })
    const whatsapp = familyRefusal({ kind: "invalid", field: "whatsapp" })
    expect(whatsapp.status === "refused" && whatsapp.message).toMatch(/WhatsApp number can't be read/)
    expect(familyRefusal({ kind: "invalid", field: "phone" })).not.toHaveProperty("canSkip")
  })

  it("lets staff go on without the check when the check itself failed", () => {
    expect(familyRefusal({ kind: "unavailable" })).toMatchObject({ status: "refused", field: null, canSkip: true })
  })
})

describe("where a listed child leads", () => {
  it("opens an active child's lead", () => {
    expect(childHref({ id: "l1", status: "Visited", closure: null })).toBe("/staff/applicants/l1")
    expect(childHref({ id: "l2", status: "Applied", closure: null })).toBe("/staff/applicants/l2")
  })

  it("sends a Declined, Inactive or Archived child to the Reopening request hand-off", () => {
    for (const child of [
      { id: "l3", status: "Declined" as const, closure: null },
      { id: "l4", status: "Visited" as const, closure: "Inactive" as const },
      { id: "l5", status: "Enrolled" as const, closure: "Archived" as const },
    ]) {
      expect(childHref(child)).toBe(`/staff/applicants/${child.id}/reopen?source=duplicate_match`)
    }
  })
})
