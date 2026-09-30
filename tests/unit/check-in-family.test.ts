import { describe, expect, it } from "vitest"

import { childHref, compareContact, relationshipLabel } from "@/app/staff/check-in/family"
import { familyRefusal } from "@/app/staff/check-in/outcome"
import type { FamilyContact } from "@/lib/services/leads"

const stored: FamilyContact = {
  id: "c1",
  fullName: "Amina Juma",
  relationship: "Mother",
  relationshipDescription: null,
  phone: "+255712345678",
  whatsapp: null,
  children: [],
}

// What staff typed, with the numbers as the database normalized them.
const typed = {
  fullName: "Amina Juma",
  relationship: "Mother" as const,
  relationshipDescription: "",
  phone: "+255712345678",
  whatsapp: null,
}

describe("comparing the typed parent with the confirmed contact", () => {
  it("finds no difference when everything matches, whatever the spacing of the name", () => {
    const result = compareContact({ ...typed, fullName: "  Amina   Juma " }, stored)
    expect(result.differs).toBe(false)
    expect(result.rows.map((row) => [row.label, row.typed, row.stored, row.differs])).toEqual([
      ["Full name", "Amina Juma", "Amina Juma", false],
      ["Relationship", "Mother", "Mother", false],
      ["Phone", "+255712345678", "+255712345678", false],
      ["WhatsApp", "Same as phone", "Same as phone", false],
    ])
  })

  it("flags a corrected name, a new WhatsApp number and a different relationship", () => {
    const result = compareContact(
      { ...typed, fullName: "Amina H. Juma", relationship: "Other", relationshipDescription: "Aunt", whatsapp: "+255787000111" },
      stored,
    )
    expect(result.differs).toBe(true)
    expect(result.rows.filter((row) => row.differs).map((row) => [row.label, row.typed, row.stored])).toEqual([
      ["Full name", "Amina H. Juma", "Amina Juma"],
      ["Relationship", "Other: Aunt", "Mother"],
      ["WhatsApp", "+255787000111", "Same as phone"],
    ])
  })

  it("flags a phone given the other way round from the stored numbers", () => {
    const result = compareContact(
      { ...typed, phone: "+255787000111", whatsapp: null },
      { ...stored, whatsapp: "+255787000111" },
    )
    expect(result.differs).toBe(true)
    expect(result.rows.filter((row) => row.differs).map((row) => row.label)).toEqual(["Phone", "WhatsApp"])
  })

  it("ignores a description typed for a relationship that is not Other", () => {
    expect(compareContact({ ...typed, relationshipDescription: "left over" }, stored).differs).toBe(false)
  })
})

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
    expect(childHref({ id: "l1", status: "Visited", closure: null })).toBe("/staff/leads/l1")
    expect(childHref({ id: "l2", status: "Applied", closure: null })).toBe("/staff/leads/l2")
  })

  it("sends a Declined, Inactive or Archived child to the Reopening request hand-off", () => {
    for (const child of [
      { id: "l3", status: "Declined" as const, closure: null },
      { id: "l4", status: "Visited" as const, closure: "Inactive" as const },
      { id: "l5", status: "Enrolled" as const, closure: "Archived" as const },
    ]) {
      expect(childHref(child)).toBe(`/staff/leads/${child.id}/reopen?source=duplicate_match`)
    }
  })
})
