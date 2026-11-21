import { describe, expect, test } from "vitest"

import {
  comingIntake,
  feePreview,
  feeSignature,
  households,
  broughtChoices,
  isEmpty,
  linking,
  onFileAnswer,
  onFileLinks,
  onFileQuestion,
  otherFather,
  payload,
  people,
  savedFather,
  settled,
  withCustodian,
  withName,
  withoutStudent,
  withSibling,
  yearOf,
  type Answers,
  type BandFees,
  type FeeTable,
  type KnownContact,
  type OnFileFee,
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
  gender: "Girl",
  className: "STD 5",
  board: "Day",
  ...more,
})
const form = (students: Student[], more: Partial<Answers> = {}): Answers => ({ students, custodians: {}, onFileAsks: [], onFile: {}, ...more })
// A child on file as the form reads it: in no sibling group yet, and free to be the full payer.
const onFileFee = (more: Partial<OnFileFee> = {}): OnFileFee => ({
  leadId: "L1",
  createdAt: "2026-10-01T08:00:00+00:00",
  name: "SALMA JUMA MRISHO",
  className: "STD 4",
  status: "Visited",
  fee: 1_300_000,
  pays: 1_300_000,
  anchorName: null,
  fullPayerName: null,
  groupId: null,
  father: "JUMA SALIM MRISHO",
  counted: [],
  selfCounts: true,
  mayPayFull: true,
  ...more,
})

describe("the year a student joins", () => {
  test("is the current admission year: this year before 1 June, next year from 1 June", () => {
    expect(comingIntake([2026, 2027], "2026-04-01")).toBe(2026)
    expect(comingIntake([2026, 2027], "2026-05-31")).toBe(2026)
    expect(comingIntake([2026, 2027], "2026-06-01")).toBe(2027)
    expect(comingIntake([2026, 2027], "2026-12-31")).toBe(2027)
    expect(comingIntake([2027, 2028], "2027-01-01")).toBe(2027)
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
      student(4, "AMANI", "JUMA SALIMU MRISHO", { sibling: { kind: "request", of: 2, note: "", requestId: "x", close: true, against: "JUMA SALIM MRISHO" } }),
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

  test("equal fees name no full payer: each tied row shows both prices, and a request waits at the full fee", () => {
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIMU MRISHO", { sibling: { kind: "typo", of: 1, spelling: "JUMA SALIM MRISHO", against: "JUMA SALIM MRISHO" } }),
      student(3, "BAKARI", "OMARI JUMA HASSAN", { sibling: { kind: "request", of: 1, note: "", requestId: "x", close: false, against: "JUMA SALIM MRISHO" } }),
    ])
    const p = feePreview(a, FEES, 2027, {})!
    const tie = "Equal fees · one pays full, one gets 10%"
    expect(p.rows.map((r) => [r.why, r.tied ?? false, r.tone, r.fee, r.pays])).toEqual([
      [tie, true, "plain", 1_400_000, 1_400_000 * 0.9],
      [tie, true, "plain", 1_400_000, 1_400_000 * 0.9],
      ["10% requested · waits for the Manager", false, "wait", 1_400_000, 1_400_000],
    ])
    // One full and one at 10%, whichever it is, and the request at full.
    expect(p.total).toBe(1_400_000 + 1_400_000 * 0.9 + 1_400_000)
    expect(p.together).toBe(true)
  })

  test("three equal fees: one pays full and the others get 10%; a cheaper sibling's row is not tied", () => {
    const sibling = { sibling: { kind: "match", of: 1 } } as const
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", sibling),
      student(3, "BAKARI", "JUMA SALIM MRISHO", sibling),
      student(4, "ZAWADI", "JUMA SALIM MRISHO", { ...sibling, className: "KG 1" }),
    ])
    const p = feePreview(a, FEES, 2027, {})!
    const tie = "Equal fees · one pays full, the others get 10%"
    expect(p.rows.map((r) => [r.why, r.tied ?? false, r.off])).toEqual([
      [tie, true, 0],
      [tie, true, 0],
      [tie, true, 0],
      ["Sibling 10% · same father", false, 0.1],
    ])
    expect(p.total).toBe(1_400_000 + 2 * (1_400_000 * 0.9) + 1_200_000 * 0.9)
  })

  test("a dearer student after two equal fees pays full, and nothing is tied", () => {
    const sibling = { sibling: { kind: "match", of: 1 } } as const
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", sibling),
      student(3, "BAKARI", "JUMA SALIM MRISHO", { ...sibling, className: "FORM 1" }),
    ])
    const p = feePreview(a, FEES, 2027, {})!
    expect(p.rows.map((r) => [r.why, r.tied ?? false])).toEqual([
      ["Sibling 10% · same father", false],
      ["Sibling 10% · same father", false],
      ["Pays full · highest fee", false],
    ])
  })

  const onFile = (fee: number | null, more: Partial<Answers> = {}) => ({
    answers: (students: Student[]) =>
      form(students, {
        onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA JUMA MRISHO", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
        onFile: { 1: { leadId: "L1", yes: true } },
        ...more,
      }),
    fees: { L1: onFileFee({ fee, pays: fee }) },
  })

  test("a child on file with the same fee wins the tie: it is older, so it pays full", () => {
    const file = onFile(1_400_000)
    const p = feePreview(file.answers([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } })]), FEES, 2027, file.fees)!
    expect(p.rows.map((r) => [r.why, r.tied ?? false])).toEqual([
      ["Sibling 10% · same father", false],
      ["Sibling 10% · same father", false],
      ["Pays full · highest fee", false],
    ])
  })

  test("new students tied above a cheaper child on file: the tie stands, and the child on file gets the 10% with no payer named", () => {
    const file = onFile(1_300_000)
    const p = feePreview(file.answers([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "match", of: 1 } })]), FEES, 2027, file.fees)!
    expect(p.rows.map((r) => [r.why, r.tied ?? false, r.pays])).toEqual([
      ["Equal fees · one pays full, one gets 10%", true, 1_400_000 * 0.9],
      ["Equal fees · one pays full, one gets 10%", true, 1_400_000 * 0.9],
      ["Sibling 10% · same father", false, 1_300_000 * 0.9],
    ])
    expect(p.total).toBe(1_400_000 + 1_400_000 * 0.9)
  })

  test("a child on file in a year with no Fee schedule has no fee: never TZS 0, and the new student's row is as it was", () => {
    const file = onFile(null)
    const p = feePreview(file.answers([student(1, "NEEMA", "JUMA SALIM MRISHO", { className: "FORM 1" })]), FEES, 2027, file.fees)!
    expect(p.rows.map((r) => [r.name, r.why, r.fee, r.pays])).toEqual([
      ["NEEMA JUMA MRISHO", "Pays full · highest fee", 1_500_000, 1_500_000],
      ["SALMA JUMA MRISHO", "Sibling 10% · NEEMA pays full", null, null],
    ])
    expect(p.total).toBe(1_500_000)
  })

  test("a sibling on file Enrolled at full gives the new student 10%, and its own fee is kept", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO", { className: "FORM 1" })], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA JUMA MRISHO", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: { leadId: "L1", yes: true } },
    })
    const p = feePreview(a, FEES, 2027, { L1: onFileFee({ status: "Enrolled", anchorName: "SALMA JUMA MRISHO", mayPayFull: false }) })!
    expect(p.rows.map((r) => r.why)).toEqual(["Sibling 10% · SALMA is Enrolled", "Fee kept · already Enrolled"])
    expect(p.enrolledOnFile).toBe("SALMA JUMA MRISHO")
    expect(p.total).toBe(1_500_000 * 0.9)
  })

  test("a lone child on file, not yet Enrolled, gets the 10% when a dearer new sibling pays full", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO", { className: "FORM 1" })], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA JUMA MRISHO", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: { leadId: "L1", yes: true } },
    })
    const p = feePreview(a, FEES, 2027, { L1: onFileFee() })!
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

  test("sends each student's Boy or girl answer", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIM MRISHO", { gender: "Boy", sibling: { kind: "match", of: 1 } })], {
      custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } },
    })
    expect(payload(a, 2027).students.map((s) => s.gender)).toEqual(["Girl", "Boy"])
  })

  test("Not a sibling with the same father's name answers the database's question; a request carries its note, or the reason", () => {
    const a = form([
      student(1, "NEEMA", "JUMA SALIM MRISHO"),
      student(2, "HAMISI", "JUMA SALIM MRISHO", { sibling: { kind: "none" } }),
      student(3, "BAKARI", "JUMA SALIMU MRISHO", { sibling: { kind: "request", of: 1, note: " ", requestId: "r1", close: true, against: "JUMA SALIM MRISHO" } }),
    ], { custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" }, 2: { kind: "same", relationship: "Uncle", description: "" } } })
    const out = payload(a, 2027)
    expect(out.students[1].notASibling).toBe(true)
    expect(out.students[1].custodian).toEqual({ person: 1, relationship: "Other", relationshipDescription: "Uncle" })
    expect(out.students[2]).toMatchObject({ siblingOf: { student: 1 }, nameAnswer: { answer: "different" }, requestNote: "Fathers' names don't match.", requestId: "r1" })
  })

  test("a typing mistake sends the right spelling; the record that held the wrong one shows the right one", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO"), student(2, "HAMISI", "JUMA SALIMU MRISHO", { sibling: { kind: "typo", of: 1, spelling: "JUMA SALIM MRISHO", against: "JUMA SALIM MRISHO" } })])
    expect(payload(a, 2027).students[1].nameAnswer).toEqual({ answer: "typo", spelling: "JUMA SALIM MRISHO" })
    expect(savedFather(a, 2)).toBe("JUMA SALIM MRISHO")
    expect(savedFather(a, 1)).toBe("JUMA SALIM MRISHO")
    // The father as custodian is the right spelling's man, so both children share him.
    const withFather: Answers = { ...a, custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } } }
    expect(payload(withFather, 2027).people).toEqual([{ firstName: "JUMA", middleName: "SALIM", lastName: "MRISHO", phone: "0712345678", whatsapp: undefined }])
    expect(otherFather(withFather, households(withFather.students)[0])).toBeNull()
  })

  test("a requested sibling's father is another man", () => {
    const a = form([student(1, "A", "JUMA SALIM MRISHO"), student(2, "B", "OMARI JUMA HASSAN", { sibling: { kind: "request", of: 1, note: "", requestId: "r", close: false, against: "JUMA SALIM MRISHO" } })])
    expect(otherFather(a, households(a.students)[0])).toBe(2)
  })

  test("a Yes to a sibling on file links that lead and confirms its father's name", () => {
    const a = form([student(1, "NEEMA", "JUMA SALIM MRISHO")], {
      onFileAsks: [{ student: 1, leadId: "L1", name: "SALMA", admissionNumber: "ADMSN-1", father: "JUMA SALIM MRISHO", fromSave: true }],
      onFile: { 1: { leadId: "L1", yes: true } },
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

describe("the links in the database's order (review rounds 2 and 3)", () => {
  const SALIM = "JUMA SALIM MRISHO"
  const SALIMU = "JUMA SALIMU MRISHO"
  const OMARI = "OMARI JUMA HASSAN"
  const request = (of: number, against: string, close: boolean) => ({ kind: "request" as const, of, note: "", requestId: `r${of}`, close, against })
  const kinds = (a: Answers) => a.students.map((s) => s.sibling?.kind)
  const father: Answers["custodians"][number] = { kind: "father", phone: "0712345678", whatsapp: "" }
  const after = { custodians: { 1: father }, brought: { who: "person" as const, person: 0 }, feesChecked: "x" }

  test("a typing mistake fixed through one student corrects everyone already in the household", () => {
    const a = form([
      student(1, "A", SALIM),
      student(2, "B", SALIM, { sibling: { kind: "match", of: 1 } }),
      student(3, "C", SALIMU, { sibling: { kind: "typo", of: 2, spelling: SALIMU, against: SALIM } }),
    ])
    expect([1, 2, 3].map((k) => savedFather(a, k))).toEqual([SALIMU, SALIMU, SALIMU])
  })

  test("a typing mistake corrects only the students already linked: one who joins later keeps its own spelling", () => {
    const a = form([
      student(1, "A", SALIM),
      student(2, "B", SALIMU, { sibling: { kind: "typo", of: 1, spelling: SALIMU, against: SALIM } }),
      // C typed A's first spelling, and staff said it is another man.
      student(3, "C", SALIM, { sibling: { ...request(1, SALIMU, true), seen: [1] } }),
    ])
    expect(settled(a)).toBe(a)
    expect([1, 2, 3].map((k) => savedFather(a, k))).toEqual([SALIMU, SALIMU, SALIM])
    expect(otherFather(a, households(a.students)[0])).toBe(3)
    // The names were close when C was linked, so the save needs the answer to "one name, or two?".
    expect(payload(a, 2027).students[2]).toMatchObject({ siblingOf: { student: 1 }, nameAnswer: { answer: "different" } })
  })

  test("a typing mistake also corrects a student who waits on a Sibling request and holds the replaced spelling", () => {
    const a = form([
      student(1, "A", SALIM),
      student(2, "B", SALIMU, { sibling: request(1, SALIM, true) }),
      student(3, "C", SALIMU, { sibling: { kind: "typo", of: 1, spelling: SALIM, against: SALIM } }),
    ])
    expect([1, 2, 3].map((k) => savedFather(a, k))).toEqual([SALIM, SALIM, SALIM])
    // B still waits for the Manager: only its spelling changed.
    // A and C are proven siblings with equal fees, so neither is named the full payer.
    expect(feePreview(a, FEES, 2027, {})!.rows.map((r) => [r.tone, r.tied ?? false])).toEqual([
      ["plain", true],
      ["wait", false],
      ["plain", true],
    ])
  })

  test("a link is compared with the name the group counts by, never with a student who waits on a Sibling request", () => {
    const students = [student(1, "A", SALIM), student(2, "B", OMARI, { sibling: request(1, SALIM, false) }), student(3, "C", OMARI)]
    // C typed B's father's name, but B's group counts by A's.
    expect(linking(students).compared.get(3)!.get(2)).toEqual({ tier: "different", with: 1, theirs: SALIM, father: OMARI })
    expect(linking(students).compared.get(3)!.get(1)).toEqual({ tier: "different", with: 1, theirs: SALIM, father: SALIM })
    // So a match with B does not hold, and is asked again.
    const matched = form([students[0], students[1], { ...students[2], sibling: { kind: "match", of: 2 } }])
    expect(kinds(settled(matched))).toEqual([undefined, "request", undefined])
  })

  test("joining a household asks again the later answers there that the join changes", () => {
    // B said Not a sibling; C matched A. B now joins A as a typing mistake, and A takes B's spelling.
    const a = form(
      [student(1, "A", SALIM), student(2, "B", SALIMU, { sibling: { kind: "none" } }), student(3, "C", SALIM, { sibling: { kind: "match", of: 1, seen: [1] } })],
      after,
    )
    const b = withSibling(a, 2, { kind: "typo", of: 1, spelling: SALIMU, against: SALIM })
    // C is linked after B, when A already holds SALIMU: no longer the same name.
    expect(kinds(b)).toEqual([undefined, "typo", undefined])
    expect(b).toMatchObject({ custodians: {}, onFile: {}, onFileAsks: [] })
    expect(b.brought).toBeUndefined()
    expect(b.feesChecked).toBeUndefined()
    // With A keeping its spelling, C's match still holds.
    expect(kinds(withSibling(a, 2, { kind: "typo", of: 1, spelling: SALIM, against: SALIM }))).toEqual([undefined, "typo", "match"])
  })

  test("leaving a household asks again the later answers there that the leave changes, and leaves the others alone", () => {
    const a = form([
      student(1, "A", SALIM),
      student(2, "B", SALIMU, { sibling: { kind: "typo", of: 1, spelling: SALIMU, against: SALIM } }),
      // Matched A while A held B's spelling.
      student(3, "C", SALIMU, { sibling: { kind: "match", of: 1, seen: [2] } }),
      student(4, "D", OMARI, { sibling: { kind: "none" } }),
      student(5, "E", OMARI, { sibling: { kind: "match", of: 4, seen: [4] } }),
    ])
    expect(settled(a)).toBe(a)
    // B leaves: A is SALIM again, so C's name is now close, not the same.
    expect(kinds(withSibling(a, 2, { kind: "none" }))).toEqual([undefined, "none", undefined, "none", "match"])
    expect(kinds(withoutStudent(a, 2))).toEqual([undefined, undefined, "none", "match"])
  })

  test("a typing-mistake answer is asked again when the name it was compared with changes", () => {
    const a = form([student(1, "A", SALIM), student(2, "B", SALIMU, { sibling: { kind: "typo", of: 1, spelling: SALIMU, against: SALIM } })])
    // Still a close name, but not the one staff saw beside B's.
    const b = withName(a, 1, name("A", "JUMA SALIMA MRISHO"))
    expect(kinds(b)).toEqual([undefined, undefined])
    // A change to A's own name only keeps it.
    expect(kinds(withName(a, 1, name("AA", SALIM)))).toEqual([undefined, "typo"])
  })

  test("an answer is asked again when an earlier student comes to have the same father's name", () => {
    const a = form([
      student(1, "A", OMARI),
      student(2, "B", SALIM, { sibling: { kind: "none", seen: [] } }),
      student(3, "C", SALIM, { sibling: { kind: "match", of: 2, seen: [2] } }),
    ])
    expect(settled(a)).toBe(a)
    // A's father's name is corrected to SALIM: B and C never saw A named in their question.
    expect(kinds(withName(a, 1, name("A", SALIM)))).toEqual([undefined, undefined, undefined])
  })

  test("an answer naming a student no longer on the form is asked again", () => {
    const a = form([student(1, "A", SALIM), student(2, "B", SALIM, { sibling: { kind: "match", of: 7 } })])
    expect(kinds(settled(a))).toEqual([undefined, undefined])
  })

  test("a student whose same-father student chose another sibling is sent as Not a sibling, so the save does not ask", () => {
    const a = form([
      student(1, "A", SALIM),
      student(2, "B", OMARI, { sibling: { kind: "none" } }),
      // C was asked about A by name, and staff chose B.
      student(3, "C", SALIM, { sibling: { ...request(2, OMARI, false), seen: [1] } }),
    ])
    const out = payload(a, 2027).students
    expect(out[0].notASibling).toBe(true)
    expect(out[1].notASibling).toBeUndefined()
    expect(out[2].siblingOf).toEqual({ student: 2 })
    // Linked to A, nothing needs settling.
    const linked = form([a.students[0], a.students[1], { ...a.students[2], sibling: { kind: "match", of: 1, seen: [1] } }])
    expect(payload(linked, 2027).students[0].notASibling).toBeUndefined()
  })
})

describe("children on file (review round 3)", () => {
  const SALIM = "JUMA SALIM MRISHO"
  const SALIMU = "JUMA SALIMU MRISHO"
  const OMARI = "OMARI JUMA HASSAN"
  const child = (id: string, studentName: string, fatherFullName: string): KnownContact["children"][number] => ({
    id,
    admissionNumber: `ADMSN-${id}`,
    studentName,
    className: "STD 4",
    status: "Visited",
    closure: null,
    fatherFullName,
  })
  const holder = (id: string, children: KnownContact["children"]): KnownContact => ({ id, fullName: `HOLDER ${id}`, phone: "+255712000111", whatsapp: null, children })
  const known = (contact: KnownContact): Answers["custodians"][number] => ({ kind: "known", contact, phone: "0712000111", whatsapp: "", relationship: "Guardian", description: "" })
  const mother: Answers["custodians"][number] = { kind: "new", name: { firstName: "ASHA", middleName: "ALI", lastName: "SAID" }, phone: "0755000222", whatsapp: "", relationship: "Mother", description: "" }
  const X = child("X", "SALMA OMARI HASSAN", OMARI)
  const Y = child("Y", "REHEMA OMARI HASSAN", OMARI)
  // A's custodian holds X; B, whose father's name is X's, has another custodian.
  const students = [student(1, "A", SALIM), student(2, "B", OMARI, { sibling: { kind: "none" } })]

  test("a Yes is about the child staff saw: a custodian change that brings another child asks again", () => {
    const a = form(students, { custodians: { 1: known(holder("c1", [X])), 2: mother }, onFile: { 2: { leadId: "X", yes: true } }, brought: { who: "person", person: 0 } })
    expect(onFileAnswer(a, 2)).toBe(true)
    expect(payload(a, 2027).students[1]).toMatchObject({ siblingOf: { leadId: "X" }, siblingFatherFullName: OMARI })

    // A's custodian becomes someone who holds Y, with the same father's name.
    const b = withCustodian(a, 1, known(holder("c2", [Y])))
    expect(b.onFile).toEqual({})
    expect(onFileAnswer(b, 2)).toBeUndefined()
    expect(payload(b, 2027).students[1].siblingOf).toBeUndefined()
    expect(b.brought).toBeUndefined()
  })

  test("an answer kept about another child is no answer: nothing links, and the fees show no sibling", () => {
    // The state the old form reached: the Yes for X kept while the match is now Y.
    const a = form(students, { custodians: { 1: known(holder("c2", [Y])), 2: mother }, onFile: { 2: { leadId: "X", yes: true } } })
    expect(onFileAnswer(a, 2)).toBeUndefined()
    expect(payload(a, 2027).students[1].siblingOf).toBeUndefined()
    const fee = onFileFee({ leadId: "Y", name: Y.studentName, status: "Enrolled", anchorName: Y.studentName, father: OMARI, mayPayFull: false })
    expect(feePreview(a, FEES, 2027, { Y: fee, X: { ...fee, leadId: "X" } })!.rows.map((r) => r.why)).toEqual(["No discount", "No discount"])
  })

  test("a custodian change keeps another household's answer while it is still about the same child, and asks its own again", () => {
    const a = form(students, {
      custodians: { 1: known(holder("c1", [X])), 2: mother },
      onFile: { 1: { leadId: "Z", yes: false }, 2: { leadId: "X", yes: true } },
      onFileAsks: [{ student: 1, leadId: "Z", name: "ZUHURA", admissionNumber: "ADMSN-Z", father: SALIM, fromSave: true }],
    })
    // B's own custodian changes: B is asked again.
    expect(withCustodian(a, 2, { ...mother, phone: "0755000333" }).onFile).toEqual({})
    // A's custodian changes to one who still holds X: B's answer stays, and the save asks its own question again.
    const b = withCustodian(a, 1, known(holder("c3", [X])))
    expect(b.onFile).toEqual({ 2: { leadId: "X", yes: true } })
    expect(b.onFileAsks).toEqual([])
  })

  test("the child on file is matched by the name as typed, which is what the save links first", () => {
    const typo = [student(1, "A", SALIM), student(2, "B", SALIMU, { sibling: { kind: "typo" as const, of: 1, spelling: SALIMU, against: SALIM } })]
    // A is saved as SALIMU in the end, but is linked to the child on file while still SALIM.
    const withSalimu = form(typo, { custodians: { 1: known(holder("c1", [child("U", "SALMA JUMA MRISHO", SALIMU)])) } })
    expect(savedFather(withSalimu, 1)).toBe(SALIMU)
    expect(onFileAnswer({ ...withSalimu, onFile: { 1: { leadId: "U", yes: true } } }, 1)).toBeUndefined()
    const withSalim = form(typo, { custodians: { 1: known(holder("c1", [child("S", "SALMA JUMA MRISHO", SALIM)])) }, onFile: { 1: { leadId: "S", yes: true } } })
    expect(payload(withSalim, 2027).students[0]).toMatchObject({ siblingOf: { leadId: "S" }, siblingFatherFullName: SALIM })
  })
})

describe("a child on file's sibling group (review round 5)", () => {
  const SALIM = "JUMA SALIM MRISHO"
  const SALIMU = "JUMA SALIMU MRISHO"
  const OMARI = "OMARI JUMA HASSAN"
  const contact: KnownContact = {
    id: "c1",
    fullName: "MWAJUMA SAID KOMBO",
    phone: "+255712000111",
    whatsapp: null,
    children: [{ id: "X", admissionNumber: "ADMSN-X", studentName: "SALMA JUMA MRISHO", className: "STD 4", status: "Visited", closure: null, fatherFullName: SALIM }],
  }
  const known: Answers["custodians"][number] = { kind: "known", contact, phone: "0712000111", whatsapp: "", relationship: "Mother", description: "" }
  // SALMA waits on a Sibling request in a group that counts by REHEMA's father.
  const pending = (father: string) => onFileFee({ leadId: "X", groupId: "G", counted: [{ leadId: "Y", name: "REHEMA OMARI HASSAN", father }], selfCounts: false, mayPayFull: false })
  const request = (requestId: string, against = OMARI, note = "") => ({ kind: "request" as const, note, requestId, close: false, against })
  // The first student's household answered Yes to SALMA, with these sheet answers.
  const yes = (students: Student[], links?: NonNullable<Answers["onFile"][number]["links"]>): Answers =>
    form(students, { custodians: { 1: known }, onFile: { 1: { leadId: "X", yes: true, ...(links ? { links } : {}) } } })
  const neema = [student(1, "NEEMA", SALIM)]

  test("a Yes is compared with the name the child's group counts by, never with a child that waits on a Sibling request", () => {
    const a = yes(neema)
    const reads = { X: pending(OMARI) }
    const compared = { tier: "different", with: null, theirs: OMARI, onFile: "REHEMA OMARI HASSAN", father: SALIM }
    expect(linking(a.students, onFileLinks(a, reads)).onFile.get(1)).toEqual(compared)
    expect(onFileQuestion(a, reads, 1)).toEqual({ student: 1, compared })
    // Until staff answer, NEEMA is linked to nobody: no 10% on a guess.
    expect(linking(a.students, onFileLinks(a, reads)).basis.get(1)).toBeUndefined()
    // In no group, or counted by its group, the child itself is compared: the same name, and nothing to ask.
    expect(onFileQuestion(a, { X: onFileFee({ leadId: "X" }) }, 1)).toBeNull()
    expect(onFileQuestion(a, { X: { ...pending(OMARI), selfCounts: true } }, 1)).toBeNull()
  })

  test("a different name is a Sibling request: the note and the request go with the link to the child on file", () => {
    const reads = { X: pending(OMARI) }
    const a = yes(neema, { 1: request("r-1", OMARI, " Proof is coming. ") })
    expect(onFileQuestion(a, reads, 1)).toBeNull()
    expect(payload(a, 2027, reads).students[0]).toMatchObject({
      siblingOf: { leadId: "X" },
      siblingFatherFullName: SALIM,
      nameAnswer: { answer: "different" },
      requestNote: "Proof is coming.",
      requestId: "r-1",
    })
    expect(payload(yes(neema, { 1: request("r-1") }), 2027, reads).students[0].requestNote).toBe("Fathers' names don't match.")
    // NEEMA waits for the Manager, and the child on file keeps the fee it has.
    expect(feePreview(a, FEES, 2027, reads)!.rows.map((r) => [r.name, r.why, r.pays])).toEqual([
      ["NEEMA JUMA MRISHO", "10% requested · waits for the Manager", 1_400_000],
      ["SALMA JUMA MRISHO", "Fee kept", 1_300_000],
    ])
    // An answer given about another name is no answer.
    expect(onFileQuestion(yes(neema, { 1: request("r-1", SALIMU) }), reads, 1)).not.toBeNull()
  })

  test("a close name asks one name or two: a typing mistake sends its spelling, two names send a request", () => {
    const reads = { X: pending(SALIMU) }
    expect(onFileQuestion(yes(neema), reads, 1)).toMatchObject({ student: 1, compared: { tier: "close", theirs: SALIMU } })

    const typo = yes(neema, { 1: { kind: "typo", spelling: SALIMU, against: SALIMU } })
    expect(onFileQuestion(typo, reads, 1)).toBeNull()
    const sent = payload(typo, 2027, reads).students[0]
    expect(sent).toMatchObject({ siblingOf: { leadId: "X" }, nameAnswer: { answer: "typo", spelling: SALIMU } })
    expect(sent.requestNote).toBeUndefined()
    expect(linking(typo.students, onFileLinks(typo, reads)).basis.get(1)).toBe("typo_confirmed")
    // A spelling that is neither name would be refused by the save: asked again.
    expect(onFileQuestion(yes(neema, { 1: { kind: "typo", spelling: OMARI, against: SALIMU } }), reads, 1)).not.toBeNull()

    const two = yes(neema, { 1: { ...request("r-2", SALIMU), close: true } })
    expect(onFileQuestion(two, reads, 1)).toBeNull()
    expect(payload(two, 2027, reads).students[0]).toMatchObject({ nameAnswer: { answer: "different" }, requestNote: "Fathers' names don't match.", requestId: "r-2" })
  })

  test("each sibling linked to that student is compared with the group's name too, and asked in turn", () => {
    const two = [...neema, student(2, "HAMISI", SALIM, { sibling: { kind: "match", of: 1, seen: [1] } })]
    const reads = { X: pending(OMARI) }
    // NEEMA waits on a request, so HAMISI is not compared with her: the group still counts by REHEMA's father.
    expect(onFileQuestion(yes(two, { 1: request("r-1") }), reads, 1)).toMatchObject({ student: 2, compared: { tier: "different", theirs: OMARI, onFile: "REHEMA OMARI HASSAN" } })
    const both = yes(two, { 1: request("r-1"), 2: request("r-2") })
    expect(onFileQuestion(both, reads, 1)).toBeNull()
    expect(payload(both, 2027, reads).students[1]).toMatchObject({
      siblingOf: { student: 1 },
      nameAnswer: { answer: "different" },
      requestNote: "Fathers' names don't match.",
      requestId: "r-2",
    })
    expect(feePreview(both, FEES, 2027, reads)!.rows.map((r) => r.why)).toEqual([
      "10% requested · waits for the Manager",
      "10% requested · waits for the Manager",
      "Fee kept",
    ])

    // A typing mistake that takes the group's spelling: NEEMA's record now holds it, so HAMISI's name is close to hers.
    const close = { X: pending(SALIMU) }
    expect(onFileQuestion(yes(two, { 1: { kind: "typo", spelling: SALIMU, against: SALIMU } }), close, 1)).toMatchObject({ student: 2, compared: { tier: "close", theirs: SALIMU } })
    // One that keeps NEEMA's spelling corrects the group instead: HAMISI's name is the same there, and nothing is asked.
    const kept = yes(two, { 1: { kind: "typo", spelling: SALIM, against: SALIMU } })
    expect(onFileQuestion(kept, close, 1)).toBeNull()
    expect(payload(kept, 2027, close).students[1]).toMatchObject({ siblingOf: { student: 1 } })
    expect(payload(kept, 2027, close).students[1].nameAnswer).toBeUndefined()
  })

  test("an answer to a question the save itself asked is sent as given, whatever the form read of the group", () => {
    // The form read SALMA as in no group and asked nothing; the save then asked for a Sibling request.
    const reads = { X: onFileFee({ leadId: "X" }) }
    const a = yes(neema, { 1: { ...request("r-9"), fromSave: true } })
    expect(onFileQuestion(a, reads, 1)).toBeNull()
    expect(payload(a, 2027, reads).students[0]).toMatchObject({ siblingOf: { leadId: "X" }, requestNote: "Fathers' names don't match.", requestId: "r-9" })
    expect(feePreview(a, FEES, 2027, reads)!.rows[0].why).toBe("10% requested · waits for the Manager")
  })

  test("two households linked to the same child on file are one group, with one full payer between them", () => {
    // HAMISI has the same father's name and his own household: staff said he is not NEEMA's sibling, then Yes to SALMA for both.
    const students = [...neema, student(2, "HAMISI", SALIM, { className: "FORM 1", board: "Boarding", sibling: { kind: "none", seen: [1] } })]
    const a = form(students, {
      custodians: { 1: known, 2: { kind: "same", relationship: "Uncle", description: "" } },
      onFile: { 1: { leadId: "X", yes: true }, 2: { leadId: "X", yes: true } },
    })
    const reads = { X: onFileFee({ leadId: "X" }) }
    const link = linking(a.students, onFileLinks(a, reads))
    expect(link.group.get(1)).toBe(link.group.get(2))
    const p = feePreview(a, FEES, 2027, reads)!
    expect(p.rows.map((r) => [r.key, r.why, r.pays])).toEqual([
      ["1", "Sibling 10% · same father", 1_400_000 * 0.9],
      ["2", "Pays full · highest fee", 3_000_000],
      ["file:X", "Sibling 10% · HAMISI pays full", 1_300_000 * 0.9],
    ])
    expect(p.total).toBe(1_400_000 * 0.9 + 3_000_000)
    // The dearest of them all on file pays full, and both new students get the 10%.
    const dear = feePreview(a, FEES, 2027, { X: onFileFee({ leadId: "X", fee: 3_500_000, pays: 3_500_000 }) })!
    expect(dear.rows.map((r) => r.why)).toEqual(["Sibling 10% · same father", "Sibling 10% · same father", "Pays full · highest fee"])
  })

  test("a child on file the database may not choose is never the full payer, and keeps the fee it has", () => {
    // SALMA's fee is the highest, but she holds a larger discount (or a manual or fixed result): half of TZS 1,600,000.
    const held = onFileFee({ leadId: "X", fee: 1_600_000, pays: 800_000, mayPayFull: false })
    const p = feePreview(yes(neema), FEES, 2027, { X: held })!
    expect(p.rows.map((r) => [r.name, r.why, r.off, r.pays])).toEqual([
      ["NEEMA JUMA MRISHO", "Pays full · highest fee", 0, 1_400_000],
      ["SALMA JUMA MRISHO", "Fee kept", 0, 800_000],
    ])
    expect(p.total).toBe(1_400_000)
    // Free to be chosen, she pays full and NEEMA gets the 10%.
    const free = feePreview(yes(neema), FEES, 2027, { X: { ...held, pays: 1_600_000, mayPayFull: true } })!
    expect(free.rows.map((r) => [r.why, r.pays])).toEqual([
      ["Sibling 10% · same father", 1_400_000 * 0.9],
      ["Pays full · highest fee", 1_600_000],
    ])
    // Two new siblings beside her: the tie between them stands, and her fee is still kept.
    const pair = [...neema, student(2, "HAMISI", SALIM, { sibling: { kind: "match", of: 1, seen: [1] } })]
    expect(feePreview(yes(pair), FEES, 2027, { X: held })!.rows.map((r) => [r.why, r.pays])).toEqual([
      ["Equal fees · one pays full, one gets 10%", 1_400_000 * 0.9],
      ["Equal fees · one pays full, one gets 10%", 1_400_000 * 0.9],
      ["Fee kept", 800_000],
    ])
  })
})

test("a form with nothing typed is empty", () => {
  expect(isEmpty(form([{ key: 1 }]))).toBe(true)
  expect(isEmpty(form([{ key: 1, board: "Day" }]))).toBe(false)
})

describe("the last-name choice and the school's country (#511)", () => {
  test("the student's name ends with the father's middle name when that is picked, and the save says so", () => {
    const s = student(1, "Neema", "Juma Salim Mrisho", { school: { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Kenya" } })
    const middle = { ...s, name: { ...s.name!, lastNameFrom: "father_middle" as const } }
    const [sent] = payload(form([middle], { custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } } }), 2027).students
    expect(sent).toMatchObject({ lastNameFrom: "father_middle", previousSchool: { region: "Outside Tanzania", country: "Kenya" } })
    const [plain] = payload(form([s], { custodians: { 1: { kind: "father", phone: "0712345678", whatsapp: "" } } }), 2027).students
    expect(plain.lastNameFrom).toBe("father_last")
  })

  test("a changed last-name choice keeps the father's name, so no sibling answer is asked again", () => {
    const a = form([student(1, "Neema", "Juma Salim Mrisho"), student(2, "Hamisi", "Juma Salim Mrisho", { sibling: { kind: "match", of: 1, seen: [1] } })])
    const next = withName(a, 2, { ...name("Hamisi", "Juma Salim Mrisho"), lastNameFrom: "father_middle" })
    expect(next.students[1].sibling).toEqual({ kind: "match", of: 1, seen: [1] })
  })
})
