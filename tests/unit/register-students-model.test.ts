import { describe, expect, test } from "vitest"

import {
  comingIntake,
  feePreview,
  feeSignature,
  households,
  broughtChoices,
  isEmpty,
  otherFather,
  withoutDependents,
  payload,
  people,
  savedFather,
  yearOf,
  type Answers,
  type BandFees,
  type FeeTable,
  type KnownContact,
  type Student,
} from "@/app/staff/check-in/new/model"

// Register students (#308): the form's own rules, before the database checks
// them again on save.

const bands = (day: number): BandFees => ({
  nursery: { day, boarding: day + 1_500_000 },
  primary_lower: { day: day + 100_000, boarding: day + 1_600_000 },
  primary_upper: { day: day + 200_000, boarding: day + 1_700_000 },
  secondary: { day: day + 300_000, boarding: day + 1_800_000 },
})
const FEES: FeeTable = { 2026: bands(1_000_000), 2027: bands(1_200_000) }

const name = (first: string, father: string) => {
  const [fatherFirst, fatherMiddle, fatherLast] = father.split(" ")
  return { firstName: first, fatherFirst, fatherMiddle, fatherLast }
}
const student = (key: number, first: string, father: string, more: Partial<Student> = {}): Student => ({
  key,
  name: name(first, father),
  className: "STD 5",
  board: "Day",
  ...more,
})
const form = (students: Student[], more: Partial<Answers> = {}): Answers => ({ students, custodians: {}, onFileAsks: [], onFile: {}, ...more })

describe("the year a student joins", () => {
  test("is the coming intake: this year before April, next year from April", () => {
    expect(comingIntake([2026, 2027], "2026-03-31")).toBe(2026)
    expect(comingIntake([2026, 2027], "2026-04-01")).toBe(2027)
  })

  test("is the student's own once picked, else the student before's", () => {
    const s = [student(1, "NEEMA", "JUMA SALIM MRISHO", { year: 2026 }), student(2, "HAMISI", "JUMA SALIM MRISHO"), student(3, "ZAWADI", "RASHIDI KOMBO SAID", { year: 2027 })]
    expect(yearOf(s, 1, 2027)).toBe(2026)
    expect(yearOf(s, 2, 2026)).toBe(2027)
    expect(yearOf([student(1, "A", "B C D")], 0, 2027)).toBe(2027)
  })
})

describe("households", () => {
  test("siblings share one, a relative's child has its own", () => {
    const a = [
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } }),
      student(3, "ZAWADI", "RASHIDI KOMBO SAID", { sibling: { kind: "none" } }),
      student(4, "AMANI", "JUMA SALIMU MRISHO", { sibling: { kind: "request", of: 2, note: "", requestId: "x", close: false } }),
    ]
    expect(households(a)).toEqual([
      { root: 1, members: [1, 2, 4] },
      { root: 3, members: [3] },
    ])
  })
})

describe("the fee step's preview", () => {
  test("among proven siblings the highest fee pays full and the other gets 10%, whichever comes first", () => {
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", { className: "FORM 1", board: "Boarding", sibling: { kind: "match", of: 1 } }),
    ])
    const p = feePreview(a, FEES, 2027, {})!
    expect(p.rows.map((r) => [r.name, r.off, r.why])).toEqual([
      ["NEEMA JUMA MRISHO", 0.1, "Sibling 10% · same father"],
      ["HAMISI JUMA MRISHO", 0, "Pays full · highest fee"],
    ])
    expect(p.together).toBe(true)
    expect(p.total).toBe(1_400_000 * 0.9 + 3_000_000)
  })

  test("a tie goes to the earlier student, and a request waits at the full fee", () => {
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "typo", of: 1, spelling: "JUMA SALIM MRISHO" } }),
      student(3, "BAKARI", "OMARI JUMA HASSAN", { sibling: { kind: "request", of: 1, note: "", requestId: "x", close: false } }),
    ])
    const p = feePreview(a, FEES, 2027, {})!
    expect(p.rows.map((r) => r.why)).toEqual(["Pays full · highest fee", "Sibling 10% · same father", "10% requested · waits for the Manager"])
    expect(p.rows[2].pays).toBe(p.rows[2].fee)
  })

  test("a sibling on file Enrolled at full gives the new student 10%, and its own fee is kept", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO", { className: "FORM 1" })], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA JUMA MRISHO", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: true },
    })
    const p = feePreview(a, FEES, 2027, {
      L1: { leadId: "L1", name: "SALMA JUMA MRISHO", className: "STD 4", status: "Enrolled", fee: 1_300_000, pays: 1_300_000, anchorName: "SALMA JUMA MRISHO", fullPayerName: null },
    })!
    expect(p.rows.map((r) => r.why)).toEqual(["Sibling 10% · SALMA is Enrolled", "Fee kept · already Enrolled"])
    expect(p.enrolledOnFile).toBe("SALMA JUMA MRISHO")
    expect(p.total).toBe(1_500_000 * 0.9)
  })

  test("a lone child on file, not yet Enrolled, gets the 10% when a dearer new sibling pays full", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO", { className: "FORM 1" })], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA JUMA MRISHO", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: true },
    })
    const p = feePreview(a, FEES, 2027, {
      L1: { leadId: "L1", name: "SALMA JUMA MRISHO", className: "STD 4", status: "Visited", fee: 1_300_000, pays: 1_300_000, anchorName: null, fullPayerName: null },
    })!
    expect(p.rows.map((r) => [r.name, r.why, r.pays])).toEqual([
      ["NEEMA JUMA MRISHO", "Pays full · highest fee", 1_500_000],
      ["SALMA JUMA MRISHO", "Sibling 10% · NEEMA pays full", 1_300_000 * 0.9],
    ])
  })

  test("a preview that changes after it was accepted is a different signature", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } })])
    const before = feeSignature(feePreview(a, FEES, 2027, {})!)
    const after = feeSignature(feePreview({ ...a, students: [a.students[0], { ...a.students[1], className: "FORM 1" }] }, FEES, 2027, {})!)
    expect(after).not.toBe(before)
  })

  test("is left out when a year has no Fee schedule", () => {
    expect(feePreview(form([student(1, "A", "B C D", { year: 2028 })]), FEES, 2027, {})).toBeNull()
  })
})

describe("the save", () => {
  const contact: KnownContact = { id: "c0ffee00-0000-4000-8000-000000000001", fullName: "MWANAIDI SALIM JUMA", phone: "+255712000111", whatsapp: null, children: [] }

  test("one father on one phone is one person with no name; a known contact is sent by id with the typed numbers", () => {
    const a = form(
      [
        student(1, "NEEMA", "JUMA SALIM MRISHO"),
        student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } }),
        student(3, "ZAWADI", "RASHIDI KOMBO SAID", { sibling: { kind: "none" } }),
      ],
      {
        custodians: {
          1: { kind: "father", phone: "0712 345 678", whatsapp: "" },
          3: { kind: "known", contact, phone: "0712 000 111", whatsapp: "", relationship: "Other", description: "Aunt" },
        },
        brought: { who: "person", person: 0 },
      },
    )
    const out = payload(a, 2027)
    expect(out.people).toEqual([
      { firstName: "JUMA", middleName: "SALIM", lastName: "MRISHO", phone: "0712 345 678", whatsapp: undefined },
      { contactId: contact.id, alsoCheckPhones: ["0712 000 111"] },
    ])
    expect(out.students.map((s) => s.custodian)).toEqual([
      { person: 1, father: true },
      { person: 1, father: true },
      { person: 2, relationship: "Other", relationshipDescription: "Aunt" },
    ])
    expect(out.students[1].siblingOf).toEqual({ student: 1 })
    // A different father: no same-father question to settle, so nothing is sent.
    expect(out.students[2].notASibling).toBeUndefined()
    expect(out.students[0].broughtBy).toEqual({ name: "JUMA SALIM MRISHO", phone: "0712 345 678", relationship: "Father" })
    expect(out.students[2].broughtBy).toEqual({ name: "JUMA SALIM MRISHO", phone: "0712 345 678", relationship: undefined })
  })

  test("Not a sibling with the same father's name answers the database's question; a request carries its note, or the reason", () => {
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "none" } }),
      student(3, "BAKARI", "OMARI JUMA HASSAN", { sibling: { kind: "request", of: 1, note: " ", requestId: "r1", close: true } }),
    ], { custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" }, 2: { kind: "same", relationship: "Uncle", description: "" } } })
    const out = payload(a, 2027)
    expect(out.students[1].notASibling).toBe(true)
    expect(out.students[1].custodian).toEqual({ person: 1, relationship: "Other", relationshipDescription: "Uncle" })
    expect(out.students[2]).toMatchObject({ siblingOf: { student: 1 }, nameAnswer: { answer: "different" }, requestNote: "Fathers' names don't match.", requestId: "r1" })
  })

  test("a typing mistake sends the right spelling; the record that held the wrong one shows the right one", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIMU MRISHO", { sibling: { kind: "typo", of: 1, spelling: "JUMA SALIM MRISHO" } })])
    expect(payload(a, 2027).students[1].nameAnswer).toEqual({ answer: "typo", spelling: "JUMA SALIM MRISHO" })
    expect(savedFather(a, 2)).toBe("JUMA SALIM MRISHO")
    expect(savedFather(a, 1)).toBe("JUMA SALIM MRISHO")
    // The father as custodian is the right spelling's man, so both children share him.
    const withFather: Answers = { ...a, custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } } }
    expect(payload(withFather, 2027).people).toEqual([{ firstName: "JUMA", middleName: "SALIM", lastName: "MRISHO", phone: "0712345678", whatsapp: undefined }])
    expect(otherFather(withFather, households(withFather.students)[0])).toBeNull()
  })

  test("a requested sibling's father is another man", () => {
    const a = form([student(1, "A", "JUMA SALIM MRISHO"), student(2, "B", "OMARI JUMA HASSAN", { sibling: { kind: "request", of: 1, note: "", requestId: "r", close: false } })])
    expect(otherFather(a, households(a.students)[0])).toBe(2)
  })

  test("a Yes to a sibling on file links that lead and confirms its father's name", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO")], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: true },
      custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } },
    })
    expect(payload(a, 2027).students[0]).toMatchObject({ siblingOf: { leadId: "L1" }, siblingFatherFullName: "JUMA SALIM MRISHO" })
  })

  test("the same person as before is stored once", () => {
    const a = form([student(1, "A", "B C D"), student(2, "E", "F G H", { sibling: { kind: "none" } })], {
      custodians: {
        1: { kind: "new", name: { firstName: "MWAJUMA", middleName: "SAID", lastName: "KOMBO" }, phone: "0755000222", whatsapp: "", relationship: "Mother", description: "" },
        2: { kind: "same", relationship: "Aunt", description: "" },
      },
    })
    expect(people(a).people).toHaveLength(1)
  })
})

describe("who is the same person (review of #457)", () => {
  test("a father shares a person only with the same father on the same phone, never with another adult who has that phone", () => {
    const a = form([student(1, "A", "JUMA SALIM MRISHO"), student(2, "B", "OMARI JUMA HASSAN", { sibling: { kind: "none" } })], {
      custodians: {
        1: { kind: "new", name: { firstName: "ASHA", middleName: "ALI", lastName: "SAID" }, phone: "0712345678", whatsapp: "", relationship: "Mother", description: "" },
        2: { kind: "father", phone: "0712 345 678", whatsapp: "" },
      },
    })
    const { people: list, personOf } = people(a)
    expect(list).toHaveLength(2)
    expect(personOf[2]).toBe(1)
    expect(payload(a, 2027).students[1].custodian).toEqual({ person: 2, father: true })
  })

  test("two households fathered by the same man on one phone share him", () => {
    const a = form([student(1, "A", "JUMA SALIM MRISHO"), student(2, "B", "JUMA SALIM MRISHO", { sibling: { kind: "none" } })], {
      custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" }, 2: { kind: "father", phone: "0712 345 678", whatsapp: "" } },
    })
    expect(people(a).people).toHaveLength(1)
  })

  test("brought-by choices keep each person's place in the list the save reads", () => {
    const list = [
      { name: "ASHA ALI SAID", phone: "1", payload: { phone: "1" } },
      { name: "ASHA ALI SAID", phone: "2", payload: { phone: "2" } },
      { name: "NEEMA OMARI HASSAN", phone: "3", payload: { phone: "3" } },
    ]
    expect(broughtChoices(list)).toEqual([
      { name: "ASHA ALI SAID", person: 0 },
      { name: "NEEMA OMARI HASSAN", person: 2 },
    ])
  })
})

describe("answers built on other answers (review round 2)", () => {
  test("a typing mistake fixed through one student corrects the whole household, as the database does", () => {
    const a = form([
      student(1, "A", "JUMA SALIM MRISHO"),
      student(2, "B", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } }),
      student(3, "C", "JUMA SALIMU MRISHO", { sibling: { kind: "typo", of: 2, spelling: "JUMA SALIMU MRISHO" } }),
    ])
    expect([1, 2, 3].map((k) => savedFather(a, k))).toEqual(["JUMA SALIMU MRISHO", "JUMA SALIMU MRISHO", "JUMA SALIMU MRISHO"])
  })

  test("a changed answer asks again the later answers of its household, and the custodians, but leaves other households alone", () => {
    const a = form(
      [
        student(1, "A", "JUMA SALIM MRISHO"),
        student(2, "B", "OMARI JUMA HASSAN", { sibling: { kind: "none" } }),
        student(3, "C", "OMARI JUMA HASSAN", { sibling: { kind: "match", of: 2 } }),
        student(4, "D", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } }),
      ],
      { custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } }, brought: { who: "person", person: 0 }, feesChecked: "x" },
    )
    const b = withoutDependents(a, 2, false)
    expect(b.students.map((s) => s.sibling?.kind)).toEqual([undefined, "none", undefined, "match"])
    expect(b.custodians).toEqual({})
    expect(b.brought).toBeUndefined()
    expect(b.feesChecked).toBeUndefined()
  })
})

test("a form with nothing typed is empty", () => {
  expect(isEmpty(form([{ key: 1 }]))).toBe(true)
  expect(isEmpty(form([{ key: 1, board: "Day" }]))).toBe(false)
})
