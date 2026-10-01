import { describe, expect, it } from "vitest"

import { admissionYears, childNameKey, parseAdmissionForm } from "@/lib/admission-form"

const KEY = "3f2b7c1e-8d4a-4b6f-9a0e-1c2d3e4f5a6b"
const YEARS = [2026, 2027]

function form(overrides: Record<string, unknown> = {}) {
  return {
    submissionKey: KEY,
    parent: { fullName: "  Amina Fixture ", relationship: "Mother", phone: "0700 000 900", whatsapp: "" },
    children: [{ fullName: " Zawadi Fixture ", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }],
    ...overrides,
  }
}

function parse(value: unknown) {
  return parseAdmissionForm(JSON.stringify(value), YEARS)
}

describe("the enrollment years on offer", () => {
  it("are this calendar year and next, in Tanzania time", () => {
    // 21:30 UTC on 31 December is already 1 January in Dar es Salaam.
    expect(admissionYears(new Date("2026-12-31T21:30:00Z"))).toEqual([2027, 2028])
    expect(admissionYears(new Date("2026-12-31T20:30:00Z"))).toEqual([2026, 2027])
  })
})

describe("reading the posted Admission form", () => {
  it("trims what the parent typed and drops an empty WhatsApp", () => {
    const parsed = parse(form())
    expect(parsed).toEqual({
      ok: true,
      data: {
        submissionKey: KEY,
        parent: { fullName: "Amina Fixture", relationship: "Mother", phone: "0700 000 900" },
        children: [{ fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }],
      },
    })
  })

  it("keeps the Other description only for Other", () => {
    const other = parse(form({ parent: { fullName: "A", relationship: "Other", relationshipDescription: " Aunt ", phone: "0700000900" } }))
    expect(other.ok && other.data.parent.relationshipDescription).toBe("Aunt")

    const mother = parse(form({ parent: { fullName: "A", relationship: "Mother", relationshipDescription: "Aunt", phone: "0700000900" } }))
    expect(mother.ok && mother.data.parent.relationshipDescription).toBeUndefined()
  })

  it.each([
    ["the parent's name", { parent: { fullName: " ", relationship: "Mother", phone: "0700000900" } }, "contact_name"],
    ["the relationship", { parent: { fullName: "A", relationship: "Aunt", phone: "0700000900" } }, "relationship"],
    ["the Other description", { parent: { fullName: "A", relationship: "Other", phone: "0700000900" } }, "relationship_description"],
    ["the phone", { parent: { fullName: "A", relationship: "Father", phone: "  " } }, "phone"],
  ])("names %s when it is missing or wrong", (_, overrides, field) => {
    expect(parse(form(overrides))).toEqual({ ok: false, error: { field, child: null } })
  })

  it.each([
    ["the child's name", { fullName: "" }, "student_name"],
    ["a class that isn't one of the 14", { className: "PRE-FORM ONE" }, "class_name"],
    ["a year that isn't on offer", { enrollmentYear: 2028 }, "enrollment_year"],
    ["day or boarding", { dayOrBoarding: "Weekly" }, "day_or_boarding"],
  ])("names %s on its child card", (_, change, field) => {
    const child = { fullName: "Zawadi", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day", ...change }
    expect(parse(form({ children: [child] }))).toEqual({ ok: false, error: { field, child: 0 } })
  })

  it("refuses the same child twice, ignoring case and spacing", () => {
    expect(childNameKey("  Zawadi   FIXTURE ")).toBe(childNameKey("zawadi fixture"))
    const child = { fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }
    const twice = parse(form({ children: [child, { ...child, fullName: "zawadi  fixture" }] }))
    expect(twice).toEqual({ ok: false, error: { field: "duplicate_child", child: 1 } })
  })

  it("needs one to eight children", () => {
    expect(parse(form({ children: [] }))).toEqual({ ok: false, error: { field: "children", child: null } })
    const many = Array.from({ length: 9 }, (_, i) => ({
      fullName: `Child ${i}`,
      className: "STD 2",
      enrollmentYear: 2027,
      dayOrBoarding: "Day",
    }))
    expect(parse(form({ children: many }))).toEqual({ ok: false, error: { field: "children", child: null } })
  })

  it("refuses a missing or malformed submission key", () => {
    expect(parse(form({ submissionKey: "not-a-uuid" }))).toEqual({ ok: false, error: { field: "submission_key", child: null } })
  })

  it.each([
    ["no form at all", null],
    ["text that isn't JSON", "{"],
    ["a child that isn't an object", JSON.stringify(form({ children: ["Zawadi"] }))],
    ["a year sent as text", JSON.stringify(form({ children: [{ fullName: "Z", className: "STD 2", enrollmentYear: "2027", dayOrBoarding: "Day" }] }))],
    ["a name far too long", JSON.stringify(form({ parent: { fullName: "x".repeat(201), relationship: "Mother", phone: "0700000900" } }))],
  ])("treats %s as an unreadable form", (_, raw) => {
    expect(parseAdmissionForm(raw, YEARS)).toEqual({ ok: false, error: { field: "payload", child: null } })
  })
})
