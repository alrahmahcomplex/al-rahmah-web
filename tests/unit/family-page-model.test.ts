import { describe, expect, it } from "vitest"

import { byCustodian, familyHref, familyTitle, nameParts, parseFamilyIds, studentNameOf, withOwnName } from "@/app/staff/family/model"

// The Family page's address and words (#512).

const A = "6eabee23-760d-44cd-9554-cf4700406625"
const B = "2d7b992c-0f62-4af2-ad8e-5faeaf0aa411"
const C = "7485f0aa-25d9-4051-8cba-69da479b2e5a"

describe("parseFamilyIds", () => {
  it("reads 2 to 8 lead ids in the form's order", () => {
    expect(parseFamilyIds(`${A},${B},${C}`)).toEqual([A, B, C])
    expect(parseFamilyIds(familyHref([B, A]).split("=")[1])).toEqual([B, A])
  })

  it("refuses an address that does not name 2 to 8 different leads", () => {
    expect(parseFamilyIds(undefined)).toBeNull()
    expect(parseFamilyIds([A, B])).toBeNull()
    expect(parseFamilyIds(A)).toBeNull()
    expect(parseFamilyIds(`${A},${A}`)).toBeNull()
    expect(parseFamilyIds(`${A},${A.toUpperCase()}`)).toBeNull()
    expect(parseFamilyIds(`${A},not-a-lead`)).toBeNull()
    expect(parseFamilyIds(`${A},${B},`)).toBeNull()
    expect(parseFamilyIds(Array.from({ length: 9 }, (_, i) => A.slice(0, -1) + i).join(","))).toBeNull()
    expect(parseFamilyIds(Array.from({ length: 8 }, (_, i) => A.slice(0, -1) + i).join(","))).toHaveLength(8)
  })
})

describe("familyTitle", () => {
  it("names the family by the fathers' last name when every father has the same one", () => {
    expect(
      familyTitle([
        { studentName: "NEEMA JUMA MRISHO", fatherFullName: "JUMA SALIM MRISHO" },
        { studentName: "HAMISI ALLY MRISHO", fatherFullName: "ALLY OMARI MRISHO" },
      ]),
    ).toBe("The Mrisho family")
    expect(
      familyTitle([
        { studentName: "NEEMA JUMA DE SOUZA", fatherFullName: "JUMA SALIM DE SOUZA" },
        { studentName: "HAMISI JUMA DE SOUZA", fatherFullName: "JUMA SALIM DE SOUZA" },
      ]),
    ).toBe("The De Souza family")
  })

  it("lists the students' first names when the last names differ or one is missing", () => {
    expect(
      familyTitle([
        { studentName: "NEEMA JUMA MRISHO", fatherFullName: "JUMA SALIM MRISHO" },
        { studentName: "HAMISI JUMA MRISHO", fatherFullName: "JUMA SALIM MRISHO" },
        { studentName: "ZAWADI RASHIDI SAID", fatherFullName: "RASHIDI KOMBO SAID" },
      ]),
    ).toBe("The family of Neema, Hamisi and Zawadi")
    expect(
      familyTitle([
        { studentName: "NEEMA JUMA MRISHO", fatherFullName: null },
        { studentName: "HAMISI JUMA MRISHO", fatherFullName: null },
      ]),
    ).toBe("The family of Neema and Hamisi")
  })
})

describe("the student's name", () => {
  it("is built from the student's name and the father's first and last", () => {
    expect(studentNameOf(" neema ", "juma", "mrisho")).toBe("NEEMA JUMA MRISHO")
  })

  it("leaves out a part that is empty, with no stray spaces", () => {
    expect(studentNameOf("AMINA", "", "")).toBe("AMINA")
    expect(studentNameOf("AMINA", "ALI", "")).toBe("AMINA ALI")
  })

  it("changes only the student's own name, keeping the rest of the stored name word for word", () => {
    expect(withOwnName("NEEMA JUMA DE SOUZA", "NEEMA", "amina")).toBe("AMINA JUMA DE SOUZA")
    expect(withOwnName("MARY ANNE JUMA MRISHO", "MARY ANNE", "MARIA")).toBe("MARIA JUMA MRISHO")
    // Nothing after the own name, an own name the stored name does not start with, or nothing typed: built from the boxes instead.
    expect(withOwnName("AMINA", "AMINA", "ZAINA")).toBeNull()
    expect(withOwnName("NEEMA JUMA MRISHO", "AMINA", "ZAINA")).toBeNull()
    expect(withOwnName("NEEMA JUMA MRISHO", "NEEMA", " ")).toBeNull()
  })

  it("gives back the boxes the stored names were built from", () => {
    expect(nameParts("NEEMA JUMA MRISHO", "JUMA SALIM MRISHO")).toEqual({ firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO" })
    expect(nameParts("MARY ANNE JUMA MRISHO", "JUMA SALIM MRISHO")).toMatchObject({ firstName: "MARY ANNE", fatherLast: "MRISHO" })
  })

  it("keeps a last name of two words whole, so a change to the student's own name keeps it", () => {
    const parts = nameParts("NEEMA JUMA DE SOUZA", "JUMA SALIM DE SOUZA")
    expect(parts).toEqual({ firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "DE SOUZA" })
    expect(studentNameOf("AMINA", parts.fatherFirst, parts.fatherLast)).toBe("AMINA JUMA DE SOUZA")
    // Built with only the last word: the stored student name says so.
    expect(nameParts("NEEMA JUMA SOUZA", "JUMA SALIM DE SOUZA")).toMatchObject({ fatherMiddle: "SALIM DE", fatherLast: "SOUZA" })
  })

  it("falls back to first words for a name not built from the father's", () => {
    expect(nameParts("AMINA HASSANI", null)).toEqual({ firstName: "AMINA", fatherFirst: "", fatherMiddle: "", fatherLast: "" })
    expect(nameParts("AMINA HASSANI ALI", "JUMA SALIM MRISHO")).toEqual({ firstName: "AMINA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO" })
    expect(nameParts("AMINA JUMA MRISHO", "JUMA MRISHO")).toEqual({ firstName: "AMINA", fatherFirst: "JUMA", fatherMiddle: "", fatherLast: "MRISHO" })
  })
})

describe("byCustodian", () => {
  it("groups students by custodian in the students' order", () => {
    const groups = byCustodian([
      { id: 1, contactId: "x" },
      { id: 2, contactId: "y" },
      { id: 3, contactId: "x" },
    ])
    expect(groups.map((g) => [g.contactId, g.members.map((m) => m.id)])).toEqual([
      ["x", [1, 3]],
      ["y", [2]],
    ])
  })
})
