import { describe, expect, it } from "vitest"

import { admissionContact, admissionYears, childNameKey, parseAdmissionForm } from "@/lib/admission-form"

const KEY = "3f2b7c1e-8d4a-4b6f-9a0e-1c2d3e4f5a6b"
const YEARS = [2026, 2027]

function form(overrides: Record<string, unknown> = {}) {
  return {
    submissionKey: KEY,
    parent: { firstName: "  Amina ", middleName: "Hassani", lastName: "Fixture", relationship: "Mother", phone: "0700 000 900", whatsapp: "" },
    children: [{ firstName: " Zawadi ", fatherFirst: "Juma", fatherMiddle: "Ali", fatherLast: "Fixture", className: "STD 2", enrollmentYear: 2027, gender: "Girl", dayOrBoarding: "Day" }],
    ...overrides,
  }
}

const PARENT = { firstName: "Amina", middleName: "Hassani", lastName: "Fixture" }
const CHILD = { firstName: "Zawadi", fatherFirst: "Juma", fatherMiddle: "Ali", fatherLast: "Fixture" }

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
        parent: {
          fullName: "AMINA HASSANI FIXTURE",
          nameParts: { firstName: "Amina", middleName: "Hassani", lastName: "Fixture" },
          relationship: "Mother",
          phone: "0700 000 900",
        },
        children: [
          {
            fullName: "ZAWADI JUMA FIXTURE",
            nameParts: { firstName: "Zawadi", fatherFirst: "Juma", fatherMiddle: "Ali", fatherLast: "Fixture" },
            // Left out by the page, the father's last name (a page from before #513).
            lastNameFrom: "father_last",
            className: "STD 2",
            enrollmentYear: 2027,
            gender: "Girl", dayOrBoarding: "Day",
          },
        ],
      },
    })
  })

  it("keeps the Other description only for Other", () => {
    const other = parse(form({ parent: { ...PARENT, relationship: "Other", relationshipDescription: " Aunt ", phone: "0700000900" } }))
    expect(other.ok && other.data.parent.relationshipDescription).toBe("Aunt")

    const mother = parse(form({ parent: { ...PARENT, relationship: "Mother", relationshipDescription: "Aunt", phone: "0700000900" } }))
    expect(mother.ok && mother.data.parent.relationshipDescription).toBeUndefined()
  })

  it.each([
    ["the relationship", { parent: { ...PARENT, relationship: "Aunt", phone: "0700000900" } }, "relationship"],
    ["the Other description", { parent: { ...PARENT, relationship: "Other", phone: "0700000900" } }, "relationship_description"],
    ["the phone", { parent: { ...PARENT, relationship: "Father", phone: "  " } }, "phone"],
  ])("names %s when it is missing or wrong", (_, overrides, field) => {
    expect(parse(form(overrides))).toEqual({ ok: false, error: { field, child: null } })
  })

  it.each([
    ["a class that isn't one of the 14", { className: "PRE-FORM ONE" }, "class_name"],
    ["a year that isn't on offer", { enrollmentYear: 2028 }, "enrollment_year"],
    ["day or boarding", { dayOrBoarding: "Weekly" }, "day_or_boarding"],
    ["boy or girl when it is left out", { gender: undefined }, "gender"],
    ["boy or girl when it is neither", { gender: "Other" }, "gender"],
  ])("names %s on its child card", (_, change, field) => {
    const child = { ...CHILD, className: "STD 2", enrollmentYear: 2027, gender: "Girl", dayOrBoarding: "Day", ...change }
    expect(parse(form({ children: [child] }))).toEqual({ ok: false, error: { field, child: 0 } })
  })

  it("refuses the same child twice, ignoring case and spacing", () => {
    expect(childNameKey("  Zawadi   FIXTURE ")).toBe(childNameKey("zawadi fixture"))
    const child = { ...CHILD, className: "STD 2", enrollmentYear: 2027, gender: "Girl", dayOrBoarding: "Day" }
    const twice = parse(form({ children: [child, { ...child, firstName: "zawadi ", fatherLast: " FIXTURE" }] }))
    expect(twice).toEqual({ ok: false, error: { field: "duplicate_child", child: 1 } })
  })

  it("needs one to eight children", () => {
    expect(parse(form({ children: [] }))).toEqual({ ok: false, error: { field: "children", child: null } })
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...CHILD,
      firstName: `Child ${i}`,
      className: "STD 2",
      enrollmentYear: 2027,
      gender: "Girl", dayOrBoarding: "Day",
    }))
    expect(parse(form({ children: many }))).toEqual({ ok: false, error: { field: "children", child: null } })
  })

  it("keeps one Discount code for the whole form, normalized as the database stores it", () => {
    const parsed = parse(form({ discountCode: " bjn -402 " }))
    expect(parsed.ok && parsed.data.discountCode).toBe("BJN-402")
  })

  it("drops an empty Discount code", () => {
    for (const discountCode of ["", "   ", undefined, null]) {
      const parsed = parse(form({ discountCode }))
      expect(parsed.ok && "discountCode" in parsed.data).toBe(false)
    }
  })

  it("keeps a code no agent may hold, but refuses one that isn't a code", () => {
    const unknown = parse(form({ discountCode: "QQQ-000" }))
    expect(unknown.ok && unknown.data.discountCode).toBe("QQQ-000")
    expect(parse(form({ discountCode: "QQQ€000" }))).toEqual({ ok: false, error: { field: "discount_code", child: null } })
    expect(parse(form({ discountCode: 402 }))).toEqual({ ok: false, error: { field: "payload", child: null } })
  })

  it("keeps the code-holder notice's version only with a code, and only one this build knows", () => {
    const shown = parse(form({ discountCode: "BJN-402", noticeVersion: "form_v2" }))
    expect(shown.ok && shown.data.noticeVersion).toBe("form_v2")

    // An unknown version is tolerated on purpose, so pages and servers from
    // different builds can meet during a deploy: the code is kept and the
    // lead records no notice rather than one this server did not show.
    // form_v1 too: a page from the build before #282 showed the old words,
    // and this server only vouches for the notice it shows.
    for (const noticeVersion of ["form_v0", "form_v1", "form_v3", "staff_reminder", 1, null, undefined]) {
      const parsed = parse(form({ discountCode: "BJN-402", noticeVersion }))
      expect(parsed.ok, String(noticeVersion)).toBe(true)
      expect(parsed.ok && parsed.data.discountCode, String(noticeVersion)).toBe("BJN-402")
      expect(parsed.ok && "noticeVersion" in parsed.data, String(noticeVersion)).toBe(false)
    }
    const noCode = parse(form({ noticeVersion: "form_v2" }))
    expect(noCode.ok && "noticeVersion" in noCode.data).toBe(false)
  })

  it("refuses a missing or malformed submission key", () => {
    expect(parse(form({ submissionKey: "not-a-uuid" }))).toEqual({ ok: false, error: { field: "submission_key", child: null } })
  })

  it.each([
    ["no form at all", null],
    ["text that isn't JSON", "{"],
    ["a child that isn't an object", JSON.stringify(form({ children: ["Zawadi"] }))],
    ["boy or girl sent as anything but text", JSON.stringify(form({ children: [{ ...CHILD, gender: true, className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }] }))],
    ["a year sent as text", JSON.stringify(form({ children: [{ ...CHILD, className: "STD 2", enrollmentYear: "2027", gender: "Girl", dayOrBoarding: "Day" }] }))],
    ["a name far too long", JSON.stringify(form({ parent: { ...PARENT, firstName: "x".repeat(1001), relationship: "Mother", phone: "0700000900" } }))],
    // The live form's one box went with #403: only the parts are read now.
    ["the custodian's name in one box", JSON.stringify(form({ parent: { fullName: "Amina Hassani Fixture", relationship: "Mother", phone: "0700000900" } }))],
    ["the student's name in one box", JSON.stringify(form({ children: [{ fullName: "Zawadi Juma Fixture", className: "STD 2", enrollmentYear: 2027, gender: "Girl", dayOrBoarding: "Day" }] }))],
  ])("treats %s as an unreadable form", (_, raw) => {
    expect(parseAdmissionForm(raw, YEARS)).toEqual({ ok: false, error: { field: "payload", child: null } })
  })
})

describe("names sent in their parts (#400)", () => {
  const parent = { firstName: " amina ", middleName: "Juma", lastName: "fixture", relationship: "Mother", phone: "0700 000 900" }
  const child = { firstName: "zawadi", fatherFirst: " Hassan ", fatherMiddle: "Ali", fatherLast: "Mohamed", className: "STD 2", enrollmentYear: 2027, gender: "Girl", dayOrBoarding: "Day" }

  it("keeps the parts, trimmed, and builds the full names as the database stores them", () => {
    expect(parse(form({ parent, children: [child] }))).toEqual({
      ok: true,
      data: {
        submissionKey: KEY,
        parent: {
          fullName: "AMINA JUMA FIXTURE",
          nameParts: { firstName: "amina", middleName: "Juma", lastName: "fixture" },
          relationship: "Mother",
          phone: "0700 000 900",
        },
        children: [
          {
            // The student's name leaves out the father's middle name.
            fullName: "ZAWADI HASSAN MOHAMED",
            nameParts: { firstName: "zawadi", fatherFirst: "Hassan", fatherMiddle: "Ali", fatherLast: "Mohamed" },
            lastNameFrom: "father_last",
            className: "STD 2",
            enrollmentYear: 2027,
            gender: "Girl", dayOrBoarding: "Day",
          },
        ],
      },
    })
  })

  it("ends the student's name with the father's middle name when the family picked it (#513)", () => {
    const parsed = parse(form({ parent, children: [{ ...child, lastNameFrom: "father_middle" }, { ...child, firstName: "Asha", lastNameFrom: "father_last" }] }))
    expect(parsed.ok && parsed.data.children.map((c) => [c.fullName, c.lastNameFrom])).toEqual([
      ["ZAWADI HASSAN ALI", "father_middle"],
      ["ASHA HASSAN MOHAMED", "father_last"],
    ])
  })

  it.each([["mother"], [1], [null]])("treats a last-name choice of %s as an unreadable form", (lastNameFrom) => {
    expect(parse(form({ parent, children: [{ ...child, lastNameFrom }] }))).toEqual({ ok: false, error: { field: "payload", child: null } })
  })

  it("names the same student twice by the names their choices build", () => {
    // ZAWADI HASSAN ALI twice: one by his middle name, one whose father's last name is ALI.
    const twice = parse(form({ parent, children: [{ ...child, lastNameFrom: "father_middle" }, { ...child, fatherMiddle: "Omari", fatherLast: "Ali" }] }))
    expect(twice).toEqual({ ok: false, error: { field: "duplicate_child", child: 1 } })
  })

  it.each([
    ["firstName", "first_name"],
    ["fatherFirst", "father_first"],
    ["fatherMiddle", "father_middle"],
    ["fatherLast", "father_last"],
  ])("names the empty %s box of the student", (key, part) => {
    expect(parse(form({ parent, children: [child, { ...child, firstName: "Other", [key]: "  " }] }))).toEqual({
      ok: false,
      error: { field: "student_name", child: 1, part },
    })
  })

  it.each([
    ["firstName", "contact_first_name"],
    ["middleName", "contact_middle_name"],
    ["lastName", "contact_last_name"],
  ])("names the empty %s box of the custodian", (key, part) => {
    expect(parse(form({ parent: { ...parent, [key]: "" }, children: [child] }))).toEqual({
      ok: false,
      error: { field: "contact_name", child: null, part },
    })
  })

  it("names a part too long on its box rather than refusing the form", () => {
    expect(parse(form({ parent, children: [{ ...child, fatherMiddle: "A".repeat(201) }] }))).toEqual({
      ok: false,
      error: { field: "student_name", child: 0, part: "father_middle" },
    })
    expect(parse(form({ parent: { ...parent, lastName: "B".repeat(201) }, children: [child] }))).toEqual({
      ok: false,
      error: { field: "contact_name", child: null, part: "contact_last_name" },
    })
  })

  it("finds the same child twice by the built name", () => {
    expect(parse(form({ parent, children: [child, { ...child, fatherMiddle: "Other" }] }))).toEqual({
      ok: false,
      error: { field: "duplicate_child", child: 1 },
    })
  })

  it.each([
    ["a part and the one box together", { ...child, fullName: "Zawadi Hassan Mohamed" }],
    ["a missing part", { ...child, fatherMiddle: undefined }],
    ["a part that isn't text", { ...child, fatherLast: 7 }],
  ])("treats %s as an unreadable form", (_, sent) => {
    expect(parse(form({ parent, children: [sent] }))).toEqual({ ok: false, error: { field: "payload", child: null } })
  })
})

describe("admissionContact", () => {
  const form = (phone: unknown) => JSON.stringify({ parent: { phone } })

  it("reads the parent's phone in one form, however it was typed", () => {
    expect(admissionContact(form("0700 000 900"))).toBe("+255700000900")
    expect(admissionContact(form("+255 700-000-900"))).toBe("+255700000900")
    expect(admissionContact(form("255700000900"))).toBe("+255700000900")
  })

  it("keeps any other number as its digits, and gives null when there is none to read", () => {
    expect(admissionContact(form("+44 20 7946 0000"))).toBe("+442079460000")
    expect(admissionContact(form(""))).toBeNull()
    expect(admissionContact(form(12))).toBeNull()
    expect(admissionContact("not json")).toBeNull()
    expect(admissionContact(null)).toBeNull()
  })
})
