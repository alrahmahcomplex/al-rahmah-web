import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { compareFields, reopeningHref } from "@/app/staff/re-applications/[id]/compare"
import type { Lead } from "@/lib/services/leads"
import { submittedChange } from "@/lib/services/re-application-apply"
import type { SubmittedDetails } from "@/lib/services/re-applications"

// Comparing a Re-application with its lead (#78): the rows side by side, which
// are highlighted, and what Apply would write.

const lead: Lead = {
  id: "1ead0000-0000-4000-8000-000000000301",
  admissionNumber: "ADMSN-90301",
  studentName: "Zuberi Marudio",
  className: "STD 3",
  enrollmentYear: 2027,
  dayOrBoarding: "Day",
  status: "Applied",
  closure: null,
  visitDate: null,
  returningFamily: true,
  initiallyDeclined: false,
  contact: {
    id: "c0c0c0c0-0000-4000-8000-000000000301",
    fullName: "Saida Marudio",
    relationship: "Mother",
    relationshipDescription: null,
    phone: "+255700000301",
    whatsapp: null,
  },
}

const sent: SubmittedDetails = {
  contactName: "Saida Marudio",
  relationship: "Mother",
  relationshipDescription: null,
  phone: "+255700000301",
  phoneAsSent: "0700 000 301",
  whatsapp: "+255700000311",
  whatsappAsSent: "0700 000 311",
  studentName: "Zuberi Marudio",
  className: "STD 4",
  enrollmentYear: 2027,
  dayOrBoarding: "Day",
}

describe("comparing a re-application with its lead", () => {
  it("shows every field stored and sent, side by side, in the form's order", () => {
    const rows = compareFields(lead, sent, ["class_name", "whatsapp"])
    expect(rows.map((row) => [row.label, row.stored, row.sent])).toEqual([
      ["Student name", "Zuberi Marudio", "Zuberi Marudio"],
      ["Class", "STD 3", "STD 4"],
      ["Enrollment year", "2027", "2027"],
      ["Day or boarding", "Day", "Day"],
      ["Parent or guardian name", "Saida Marudio", "Saida Marudio"],
      ["Relationship", "Mother", "Mother"],
      ["Relationship details", "None", "None"],
      ["Phone", "+255 700 000 301", "+255 700 000 301"],
      ["WhatsApp", "Same as phone", "+255 700 000 311"],
    ])
  })

  it("highlights exactly the fields that differed on arrival, so the count matches the queue's", () => {
    const differing = ["class_name", "relationship", "relationship_description", "whatsapp"] as const
    const rows = compareFields(lead, sent, [...differing])
    expect(rows.filter((row) => row.differed).map((row) => row.field)).toEqual(differing)
  })

  it("says when a field that differed now matches the lead, once it is applied or corrected", () => {
    const applied = { ...lead, className: "STD 4" as const }
    const [, classRow] = compareFields(applied, sent, ["class_name", "whatsapp"])
    expect(classRow).toMatchObject({ differed: true, matchesNow: true })
    const whatsappRow = compareFields(applied, sent, ["class_name", "whatsapp"]).at(-1)
    expect(whatsappRow).toMatchObject({ differed: true, matchesNow: false })
  })

  it("shows a number as the family typed it when that reads differently", () => {
    const rows = compareFields(lead, sent, [])
    expect(rows.find((row) => row.field === "phone")?.typedAs).toBe("0700 000 301")
    expect(rows.find((row) => row.field === "whatsapp")?.typedAs).toBe("0700 000 311")
    const plain = compareFields(lead, { ...sent, phoneAsSent: "+255 700 000 301" }, [])
    expect(plain.find((row) => row.field === "phone")?.typedAs).toBeNull()
  })

  it("compares an Other relationship's details", () => {
    const other = { ...lead, contact: { ...lead.contact, relationship: "Other" as const, relationshipDescription: "Aunt" } }
    const rows = compareFields(other, { ...sent, relationship: "Other", relationshipDescription: "Grandmother" }, [
      "relationship_description",
    ])
    expect(rows.find((row) => row.field === "relationship")).toMatchObject({ stored: "Other", matchesNow: true })
    expect(rows.find((row) => row.field === "relationship_description")).toMatchObject({
      stored: "Aunt",
      sent: "Grandmother",
      differed: true,
      matchesNow: false,
    })
  })
})

describe("what Apply writes", () => {
  it("writes a student field to the lead, alone", () => {
    expect(submittedChange("student_name", sent)).toEqual({ to: "lead", changes: { fullName: "Zuberi Marudio" } })
    expect(submittedChange("class_name", sent)).toEqual({ to: "lead", changes: { className: "STD 4" } })
    expect(submittedChange("enrollment_year", sent)).toEqual({ to: "lead", changes: { enrollmentYear: 2027 } })
    expect(submittedChange("day_or_boarding", sent)).toEqual({ to: "lead", changes: { dayOrBoarding: "Day" } })
  })

  it("writes a parent or guardian field to the contact, alone", () => {
    expect(submittedChange("contact_name", sent)).toEqual({ to: "contact", changes: { fullName: "Saida Marudio" } })
    expect(submittedChange("phone", sent)).toEqual({ to: "contact", changes: { phone: "+255700000301" } })
    expect(submittedChange("whatsapp", sent)).toEqual({ to: "contact", changes: { whatsapp: "+255700000311" } })
    // None sent, or the same as the phone, is stored as none.
    expect(submittedChange("whatsapp", { ...sent, whatsapp: null })).toEqual({ to: "contact", changes: { whatsapp: null } })
  })

  it("writes the relationship and its details together, whichever row is applied", () => {
    const other = { ...sent, relationship: "Other" as const, relationshipDescription: "Grandmother" }
    const both = { to: "contact", changes: { relationship: "Other", relationshipDescription: "Grandmother" } }
    expect(submittedChange("relationship", other)).toEqual(both)
    expect(submittedChange("relationship_description", other)).toEqual(both)
    expect(submittedChange("relationship", sent)).toEqual({
      to: "contact",
      changes: { relationship: "Mother", relationshipDescription: null },
    })
  })
})

describe("Request reopening from a re-application", () => {
  it("links to the lead's reopen page with only the lead id and the re-application id", () => {
    const href = reopeningHref("1ead0000-0000-4000-8000-000000000005", "a0a0a0a0-0000-4000-8000-000000000001")
    expect(href).toBe(
      "/staff/leads/1ead0000-0000-4000-8000-000000000005/reopen?source=re_application&re_application=a0a0a0a0-0000-4000-8000-000000000001",
    )
    const url = new URL(href, "http://localhost")
    expect([...url.searchParams.keys()]).toEqual(["source", "re_application"])
  })
})
