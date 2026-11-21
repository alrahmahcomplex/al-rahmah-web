import { describe, expect, it } from "vitest"

import { byCustodian, familyHref, familyTitle, ownName, parseFamilyIds, studentNameOf } from "@/app/staff/family/model"

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

  it("gives back the student's own name, also when it has two words", () => {
    expect(ownName("NEEMA JUMA MRISHO", "JUMA SALIM MRISHO")).toBe("NEEMA")
    expect(ownName("MARY ANNE JUMA MRISHO", "JUMA SALIM MRISHO")).toBe("MARY ANNE")
    // A name not built from the father's: its first word.
    expect(ownName("AMINA HASSANI", null)).toBe("AMINA")
    expect(ownName("AMINA HASSANI ALI", "JUMA SALIM MRISHO")).toBe("AMINA")
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
