import { describe, expect, it } from "vitest"

import { checkInStudents, familyName, formName, givenRelationship, personParts, startCheckIn } from "@/app/staff/check-in/[id]/model"
import { feePreview, households, mentionsSiblings, payload, type Answers, type OnFileFee, type Student } from "@/app/staff/check-in/new/model"
import type { AdmissionFormFamily, FormChild } from "@/lib/services/admission-form-family"

// Check-in of an Admission form family (#309): it starts from what the form
// gave, and asks only the rest.

const PARENT = "c0a70000-0000-4000-8000-000000000309"
// When the form's children were made: one form makes them together.
const SENT = "2026-11-09T07:30:00+00:00"

const child = (more: Partial<FormChild> = {}): FormChild => ({
  leadId: "11111111-1111-4111-8111-111111111111",
  contactId: PARENT,
  admissionNumber: "ADMSN-90005",
  studentName: "YUSUF ALI HASSAN",
  fatherFullName: "ALI OMARI HASSAN",
  gender: "Boy",
  className: "STD 6",
  enrollmentYear: 2027,
  dayOrBoarding: "Day",
  status: "Applied",
  closure: null,
  previousSchool: null,
  broughtByName: null,
  linked: false,
  groupId: null,
  ...more,
})

const family = (children: FormChild[]): AdmissionFormFamily => ({
  sentOn: "2026-11-09",
  contact: {
    id: PARENT,
    fullName: "SAIDA OMARI HASSAN",
    relationship: "Mother",
    relationshipDescription: null,
    phone: "+255755000222",
    whatsapp: null,
    familyMatch: false,
  },
  children,
  onFile: [
    { leadId: "o1", admissionNumber: "ADMSN-80001", studentName: "SALMA ALI HASSAN", className: "STD 4", status: "Enrolled", closure: null, fatherFullName: "ALI OMARI HASSAN" },
  ],
})

describe("the name parts check-in starts from", () => {
  it("are complete when the father has three names and they make the stored name", () => {
    expect(formName("YUSUF ALI HASSAN", "ALI OMARI HASSAN")).toEqual({
      name: { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN" },
      complete: true,
    })
  })

  it.each([
    // The one-box form's two-word father: his middle name is asked.
    ["YUSUF ALI HASSAN", "ALI HASSAN"],
    // No father's name on the lead: the words after the first, still two.
    ["YUSUF ALI HASSAN", null],
    // Three father's names that would change the stored student name.
    ["NEEMA JUMA SALIM MRISHO", "JUMA SALIM MRISHO"],
    // Four father's names: staff confirm how they split.
    ["NEEMA JUMA MRISHO", "JUMA SALIM ALLY MRISHO"],
  ])("are asked when %s has the father %s", (student, father) => {
    expect(formName(student, father).complete).toBe(false)
  })

  it("prefill a two-word father with his first and last names", () => {
    expect(formName("YUSUF ALI HASSAN", "Ali  Hassan").name).toEqual({ firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "", fatherLast: "HASSAN" })
  })

  it("split a person's stored name into the three boxes", () => {
    expect(personParts("Saida Omari Hassan")).toEqual({ firstName: "SAIDA", middleName: "OMARI", lastName: "HASSAN" })
    expect(personParts("SAIDA HASSAN")).toEqual({ firstName: "SAIDA", middleName: "", lastName: "HASSAN" })
    expect(personParts("ZAINA MWANAIDI SALIM JUMA")).toEqual({ firstName: "ZAINA", middleName: "MWANAIDI SALIM", lastName: "JUMA" })
  })
})

describe("the answers check-in starts from", () => {
  const cousin = child({
    leadId: "22222222-2222-4222-8222-222222222222",
    admissionNumber: "ADMSN-90006",
    studentName: "ZAWADI RASHIDI SAID",
    fatherFullName: "RASHIDI KOMBO SAID",
    gender: null,
    className: "KG 2",
  })
  const { answers, checkIn } = startCheckIn(family([child(), cousin]), [child(), cousin])

  it("fill in what the form gave and leave the rest to ask", () => {
    expect(answers.students[0]).toEqual({
      key: 1,
      name: { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN" },
      gender: "Boy",
      className: "STD 6",
      year: 2027,
      board: "Day",
    })
    // No Boy or girl answer from the form: it is asked.
    expect(answers.students[1].gender).toBeUndefined()
    expect(answers.more).toBe(true)
    expect(answers.custodians).toEqual({})
    expect(checkIn.children.map((c) => c.given)).toEqual([
      { name: true, gender: true },
      { name: true, gender: false },
    ])
  })

  it("keep a previous school the record holds, only where the class asks one", () => {
    const school = { notKnown: true as const }
    const { answers: a } = startCheckIn(family([]), [child({ previousSchool: school }), child({ className: "STD 1", previousSchool: school })])
    expect(a.students[0].school).toEqual(school)
    expect(a.students[1].school).toBeUndefined()
  })

  it("offer the form's parent with the children on file under them", () => {
    expect(checkIn.contact).toMatchObject({ relationship: "Mother", contact: { id: PARENT, fullName: "SAIDA OMARI HASSAN" } })
    expect(checkIn.contact?.contact.children).toEqual([expect.objectContaining({ id: "o1", fatherFullName: "ALI OMARI HASSAN" })])
  })

  // separate_from_family gives one child a copy of the parent, with the same name and number.
  it("offer no parent when a child checked in sits on another contact, so the number is looked up", () => {
    const COPY = "c0a70000-0000-4000-8000-000000000310"
    // Whichever child staff looked up, `contact` is that child's: neither is offered for both.
    const split = startCheckIn(family([child(), { ...cousin, contactId: COPY }]), [child(), { ...cousin, contactId: COPY }])
    expect(split.checkIn.contact).toBeNull()
    const looked = family([child({ contactId: COPY }), cousin])
    expect(startCheckIn({ ...looked, contact: { ...looked.contact!, id: COPY } }, looked.children).checkIn.contact).toBeNull()
    // The rest of what the form gave is still filled in.
    expect(split.answers.students.map((s) => s.name?.firstName)).toEqual(["YUSUF", "ZAWADI"])
    expect(split.answers.custodians).toEqual({})
  })

  it("still offer the parent when only a child not checked in sits on another contact", () => {
    const visited = { ...cousin, status: "Visited" as const, contactId: "c0a70000-0000-4000-8000-000000000310" }
    expect(startCheckIn(family([child(), visited]), [child()]).checkIn.contact?.contact.id).toBe(PARENT)
  })

  it("preselect the relationship the form gave, but never Father, which is the switch", () => {
    const given = checkIn.contact!
    expect(givenRelationship(given)).toEqual({ choice: "Mother", description: "" })
    expect(givenRelationship({ ...given, relationship: "Other", description: "Aunt" })).toEqual({ choice: "Other", description: "Aunt" })
    expect(givenRelationship({ ...given, relationship: "Father" })).toBeNull()
  })

  it("name the family after the first child's last name", () => {
    expect(familyName([child()])).toBe("Hassan")
  })
})

describe("the save check-in sends", () => {
  const linked = child({ leadId: "22222222-2222-4222-8222-222222222222", studentName: "MARIAM ALI HASSAN", className: "STD 1", linked: true, groupId: "g9" })
  const { answers: start, checkIn } = startCheckIn(family([]), [child(), linked])
  const answers = {
    ...start,
    custodians: { 1: { kind: "known" as const, contact: checkIn.contact!.contact, phone: "+255755000222", whatsapp: "", relationship: "Mother" as const, description: "" } },
    brought: { who: "person" as const, person: 0 },
    students: start.students.map((s) => (s.key === 2 ? { ...s, sibling: { kind: "none" as const } } : s)),
  }
  const sent = checkInStudents(payload(answers, 2027).students, answers, checkIn)

  it("carries each child's lead and leaves out the class, year and Day or Boarding", () => {
    expect(sent.map((s) => s.leadId)).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])
    for (const s of sent) {
      expect(s).not.toHaveProperty("className")
      expect(s).not.toHaveProperty("enrollmentYear")
      expect(s).not.toHaveProperty("dayOrBoarding")
    }
    expect(sent[0]).toMatchObject({ firstName: "YUSUF", fatherMiddle: "OMARI", custodian: { person: 1, relationship: "Mother" }, broughtBy: { name: "SAIDA OMARI HASSAN" } })
  })

  it("sends no sibling choice for a child already in a sibling group, which keeps its link", () => {
    expect(sent[1]).not.toHaveProperty("notASibling")
    expect(sent[1]).not.toHaveProperty("siblingOf")
  })
})

describe("the fee step for a child already in a sibling group (#309)", () => {
  const FEES = { 2027: { nursery: { day: 1_000_000, boarding: 2_500_000 }, primary_lower: { day: 1_100_000, boarding: 2_600_000 }, primary_upper: { day: 1_200_000, boarding: 2_700_000 }, secondary: { day: 1_300_000, boarding: 2_800_000 } } }
  const yusuf: Student = { key: 1, name: { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN" }, gender: "Boy", className: "STD 6", year: 2027, board: "Day" }
  const group = (more: Partial<OnFileFee>): OnFileFee => ({
    leadId: "11111111-1111-4111-8111-111111111111",
    createdAt: SENT,
    name: "YUSUF ALI HASSAN",
    className: "STD 6",
    status: "Applied",
    fee: 1_200_000,
    pays: 1_200_000,
    anchorName: null,
    fullPayerName: null,
    groupId: "g1",
    father: "ALI OMARI HASSAN",
    counted: [],
    selfCounts: true,
    mayPayFull: true,
    ...more,
  })
  const answers: Answers = { students: [yusuf], more: true, custodians: {}, onFileAsks: [], onFile: {} }

  it("gives the 10% its group gives, by the sibling Enrolled there, and lists the child once", () => {
    const preview = feePreview(answers, FEES, 2027, {}, { 1: group({ anchorName: "SALMA ALI HASSAN" }) })!
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0]).toMatchObject({ key: "1", name: "YUSUF ALI HASSAN", why: "Sibling 10% · SALMA is Enrolled", off: 0.1, pays: 1_080_000 })
    expect(preview.total).toBe(1_080_000)
    expect(mentionsSiblings(answers, preview)).toBe(true)
  })

  it("keeps the full fee of the group's full payer", () => {
    const preview = feePreview(answers, FEES, 2027, {}, { 1: group({ fullPayerName: "YUSUF ALI HASSAN" }) })!
    expect(preview.rows[0]).toMatchObject({ why: "Pays full · highest fee", pays: 1_200_000 })
  })

  it("without the group, shows the fee as a new student's, as before", () => {
    const preview = feePreview(answers, FEES, 2027, {})!
    expect(preview.rows[0]).toMatchObject({ why: "No discount", pays: 1_200_000 })
  })
})

describe("children already siblings in one group (#309)", () => {
  const first = child({ linked: true, groupId: "g1" })
  const second = child({ leadId: "22222222-2222-4222-8222-222222222222", studentName: "MARIAM ALI HASSAN", className: "STD 1", linked: true, groupId: "g1" })

  it("start as one household, so one custodian question covers both", () => {
    const { answers } = startCheckIn(family([]), [first, second])
    expect(answers.students[1].sibling).toMatchObject({ kind: "match", of: 1 })
    expect(households(answers.students)).toEqual([{ root: 1, members: [1, 2] }])
  })

  it("both save with the custodian and relationship staff gave once, and no sibling choice", () => {
    const { answers: start, checkIn } = startCheckIn(family([]), [first, second])
    const answers = {
      ...start,
      custodians: { 1: { kind: "known" as const, contact: checkIn.contact!.contact, phone: "+255755000222", whatsapp: "", relationship: "Mother" as const, description: "" } },
      brought: { who: "person" as const, person: 0 },
    }
    const sent = checkInStudents(payload(answers, 2027).students, answers, checkIn)
    expect(sent.map((s) => s.custodian)).toEqual([
      { person: 1, relationship: "Mother" },
      { person: 1, relationship: "Mother" },
    ])
    for (const s of sent) expect(s).not.toHaveProperty("siblingOf")
  })

  it("stay apart when their fathers' names differ, or their groups do", () => {
    const other = { ...second, fatherFullName: "OMARI JUMA SAID", studentName: "MARIAM OMARI SAID" }
    expect(households(startCheckIn(family([]), [first, other]).answers.students)).toHaveLength(2)
    expect(households(startCheckIn(family([]), [first, { ...second, groupId: "g2" }]).answers.students)).toHaveLength(2)
  })

  it("show each one's fee in the group, once each", () => {
    const FEES = { 2027: { nursery: { day: 1_000_000, boarding: 2_500_000 }, primary_lower: { day: 1_100_000, boarding: 2_600_000 }, primary_upper: { day: 1_200_000, boarding: 2_700_000 }, secondary: { day: 1_300_000, boarding: 2_800_000 } } }
    const { answers } = startCheckIn(family([]), [first, second])
    const read = (leadId: string, name: string, fee: number, pays: number): OnFileFee => ({
      leadId, createdAt: SENT, name, className: "STD 6", status: "Applied", fee, pays, anchorName: null, fullPayerName: "YUSUF ALI HASSAN", groupId: "g1",
      father: "ALI OMARI HASSAN", counted: [], selfCounts: true, mayPayFull: true,
    })
    const preview = feePreview(answers, FEES, 2027, {}, {
      1: read(first.leadId, "YUSUF ALI HASSAN", 1_200_000, 1_200_000),
      2: read(second.leadId, "MARIAM ALI HASSAN", 1_100_000, 990_000),
    })!
    expect(preview.rows.map((r) => [r.key, r.why, r.pays])).toEqual([
      ["1", "Pays full · highest fee", 1_200_000],
      ["2", "Sibling 10% · YUSUF pays full", 990_000],
    ])
  })
})

describe("a discount a child holds on file at check-in (#309)", () => {
  const FEES = { 2027: { nursery: { day: 1_000_000, boarding: 2_500_000 }, primary_lower: { day: 1_100_000, boarding: 2_600_000 }, primary_upper: { day: 1_200_000, boarding: 2_700_000 }, secondary: { day: 1_300_000, boarding: 2_800_000 } } }
  const yusuf: Student = { key: 1, name: { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN" }, gender: "Boy", className: "STD 6", year: 2027, board: "Day" }
  const answers: Answers = { students: [yusuf], more: true, custodians: {}, onFileAsks: [], onFile: {} }
  const own = (more: Partial<OnFileFee>): OnFileFee => ({
    leadId: "11111111-1111-4111-8111-111111111111", createdAt: SENT, name: "YUSUF ALI HASSAN", className: "STD 6", status: "Applied", fee: 1_200_000, pays: 1_200_000,
    anchorName: null, fullPayerName: null, groupId: null, father: "ALI OMARI HASSAN", counted: [], selfCounts: true, mayPayFull: true, ...more,
  })

  it("keeps a Sibling 10% set by hand, which the save never changes", () => {
    const preview = feePreview(answers, FEES, 2027, {}, {}, { 1: own({ pays: 1_080_000, manual: true }) })!
    expect(preview.rows[0]).toMatchObject({ why: "Fee kept", fee: 1_200_000, pays: 1_080_000, off: 0.1 })
    expect(preview.total).toBe(1_080_000)
  })

  it("keeps a full fee set by hand where the rule would give the 10%", () => {
    const mariam: Student = { ...yusuf, key: 2, name: { ...yusuf.name!, firstName: "MARIAM" }, className: "STD 1", sibling: { kind: "match", of: 1, seen: [1] } }
    const two: Answers = { ...answers, students: [yusuf, mariam] }
    const preview = feePreview(two, FEES, 2027, {}, {}, { 2: own({ leadId: "m", fee: 1_100_000, pays: 1_100_000, manual: true }) })!
    expect(preview.rows[1]).toMatchObject({ why: "Fee kept", pays: 1_100_000, off: 0 })
  })

  it("keeps a 10% the rule would take away, since the save never raises a fee", () => {
    const preview = feePreview(answers, FEES, 2027, {}, {}, { 1: own({ pays: 1_080_000 }) })!
    expect(preview.rows[0]).toMatchObject({ why: "Fee kept", pays: 1_080_000 })
  })

  it("shows the rule's fee when the child holds nothing more", () => {
    const preview = feePreview(answers, FEES, 2027, {}, {}, { 1: own({}) })!
    expect(preview.rows[0]).toMatchObject({ why: "No discount", pays: 1_200_000 })
  })
})

// The database's choose_full_payer never ranks a result set by hand or fixed at an enrolment, or a larger
// discount. A 10% the save keeps (source `legacy`) is ranked like any other.
describe("the full payer among children checked in as siblings (#309)", () => {
  const FEES = { 2027: { nursery: { day: 1_000_000, boarding: 2_500_000 }, primary_lower: { day: 1_100_000, boarding: 2_600_000 }, primary_upper: { day: 1_200_000, boarding: 2_700_000 }, secondary: { day: 1_300_000, boarding: 2_800_000 } } }
  const yusuf: Student = { key: 1, name: { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN" }, gender: "Boy", className: "STD 6", year: 2027, board: "Day" }
  const sibling = (key: number, firstName: string, className: Student["className"]): Student => ({ ...yusuf, key, name: { ...yusuf.name!, firstName }, className, sibling: { kind: "match", of: 1, seen: [1] } })
  const mariam = sibling(2, "MARIAM", "STD 1")
  const family = (...students: Student[]): Answers => ({ students, more: true, custodians: {}, onFileAsks: [], onFile: {} })
  const own = (more: Partial<OnFileFee>): OnFileFee => ({
    leadId: "11111111-1111-4111-8111-111111111111", createdAt: SENT, name: "YUSUF ALI HASSAN", className: "STD 6", status: "Applied", fee: 1_200_000, pays: 1_200_000,
    anchorName: null, fullPayerName: null, groupId: null, father: "ALI OMARI HASSAN", counted: [], selfCounts: true, mayPayFull: true, unranked: false, ...more,
  })
  const byHand = { manual: true, unranked: true, mayPayFull: false }
  const shown = (p: ReturnType<typeof feePreview>) => p!.rows.map((r) => [r.key, r.why, r.off, r.pays, r.tied ?? false])

  it.each([
    ["set by hand", byHand],
    ["fixed at an earlier enrolment", { unranked: true, mayPayFull: false }],
  ])("a higher fee with a Sibling 10%% %s is not the full payer: the next sibling pays full", (_why, more) => {
    const preview = feePreview(family(yusuf, mariam), FEES, 2027, {}, {}, { 1: own({ pays: 1_080_000, ...more }) })
    expect(shown(preview)).toEqual([
      ["1", "Fee kept", 0.1, 1_080_000, false],
      ["2", "Pays full", 0, 1_100_000, false],
    ])
    expect(preview!.total).toBe(2_180_000)
  })

  it("a higher fee with a 10% the save keeps is still the full payer, so its sibling gets the 10% too", () => {
    const preview = feePreview(family(yusuf, mariam), FEES, 2027, {}, {}, { 1: own({ pays: 1_080_000 }), 2: own({ leadId: "m", fee: 1_100_000, pays: 1_100_000 }) })
    expect(shown(preview)).toEqual([
      ["1", "Fee kept", 0.1, 1_080_000, false],
      ["2", "Sibling 10% · same father", 0.1, 990_000, false],
    ])
    expect(preview!.total).toBe(2_070_000)
  })

  it("a lower fee set by hand keeps its fee beside the full payer and a third sibling's 10%", () => {
    const preview = feePreview(family(yusuf, mariam, sibling(3, "ZAINAB", "KG 2")), FEES, 2027, {}, {}, { 2: own({ leadId: "m", fee: 1_100_000, pays: 990_000, ...byHand }) })
    expect(shown(preview)).toEqual([
      ["1", "Pays full · highest fee", 0, 1_200_000, false],
      ["2", "Fee kept", 0.1, 990_000, false],
      ["3", "Sibling 10% · same father", 0.1, 900_000, false],
    ])
    expect(preview!.total).toBe(3_090_000)
  })

  it("an equal fee set by hand is no tie: the other one pays full", () => {
    const preview = feePreview(family(yusuf, sibling(2, "MARIAM", "STD 6")), FEES, 2027, {}, {}, { 1: own({ pays: 1_080_000, ...byHand }) })
    expect(shown(preview)).toEqual([
      ["1", "Fee kept", 0.1, 1_080_000, false],
      ["2", "Pays full · highest fee", 0, 1_200_000, false],
    ])
    expect(preview!.total).toBe(2_280_000)
  })

  // choose_full_payer orders by the fee, then `l.created_at, l.id`. At check-in every child has a record.
  describe("on an equal fee, the older record pays full, then the lower lead id", () => {
    const LOW = "11111111-1111-4111-8111-111111111111"
    const HIGH = "22222222-2222-4222-8222-222222222222"
    const LATER = "2026-11-12T09:00:00+00:00"
    const twin = sibling(2, "MARIAM", "STD 6")
    const mariamPays = [
      ["1", "Sibling 10% · MARIAM pays full", 0.1, 1_080_000, false],
      ["2", "Pays full · highest fee", 0, 1_200_000, false],
    ]
    const yusufPays = [
      ["1", "Pays full · highest fee", 0, 1_200_000, false],
      ["2", "Sibling 10% · same father", 0.1, 1_080_000, false],
    ]

    it.each([
      ["made with it, with a lower lead id", { leadId: HIGH, groupId: "g1" }, { leadId: LOW }, mariamPays],
      ["made with it, with a higher lead id", { leadId: LOW, groupId: "g1" }, { leadId: HIGH }, yusufPays],
      ["made before it, whatever the lead ids", { leadId: LOW, groupId: "g1", createdAt: LATER }, { leadId: HIGH }, mariamPays],
    ])("a child answered Sibling of one already in a group, %s", (_why, linked, unlinked, rows) => {
      const preview = feePreview(family(yusuf, twin), FEES, 2027, {}, { 1: own(linked) }, { 2: own({ name: "MARIAM ALI HASSAN", ...unlinked }) })
      expect(shown(preview)).toEqual(rows)
      expect(preview!.total).toBe(2_280_000)
    })

    it("two of the form's children with no group yet are no tie: the lower lead id pays full", () => {
      const preview = feePreview(family(yusuf, twin), FEES, 2027, {}, {}, { 1: own({ leadId: HIGH }), 2: own({ leadId: LOW, name: "MARIAM ALI HASSAN" }) })
      expect(shown(preview)).toEqual([
        ["1", "Sibling 10% · same father", 0.1, 1_080_000, false],
        ["2", "Pays full · highest fee", 0, 1_200_000, false],
      ])
    })

    // A sibling on file under the custodian, linked by staff's Yes on the on-file question.
    const salma = { id: "S", admissionNumber: "ADMSN-80001", studentName: "SALMA ALI HASSAN", className: "STD 6" as const, status: "Visited" as const, closure: null, fatherFullName: "ALI OMARI HASSAN" }
    const withSalma: Answers = {
      ...family(yusuf),
      custodians: { 1: { kind: "known", contact: { id: "c", fullName: "SAIDA OMARI HASSAN", phone: "+255755000222", whatsapp: null, children: [salma] }, phone: "+255755000222", whatsapp: "", relationship: "Mother", description: "" } },
      onFile: { 1: { leadId: "S", yes: true } },
    }
    const onFile = (createdAt: string) => ({ S: own({ leadId: "S", name: "SALMA ALI HASSAN", createdAt }) })

    it("a sibling registered at the desk after the form was sent does not take the place", () => {
      const preview = feePreview(withSalma, FEES, 2027, onFile(LATER), {}, { 1: own({}) })
      expect(shown(preview)).toEqual([
        ["1", "Pays full · highest fee", 0, 1_200_000, false],
        ["file:S", "Sibling 10% · YUSUF pays full", 0.1, 1_080_000, false],
      ])
    })

    it("a sibling on file before the form was sent pays full", () => {
      const preview = feePreview(withSalma, FEES, 2027, onFile("2026-10-01T08:00:00+00:00"), {}, { 1: own({}) })
      expect(shown(preview)).toEqual([
        ["1", "Sibling 10% · same father", 0.1, 1_080_000, false],
        ["file:S", "Pays full · highest fee", 0, 1_200_000, false],
      ])
    })

    it("in Register students the new student has no record, so the sibling on file pays full as before", () => {
      const preview = feePreview(withSalma, FEES, 2027, onFile(LATER))
      expect(shown(preview)).toEqual([
        ["1", "Sibling 10% · same father", 0.1, 1_080_000, false],
        ["file:S", "Pays full · highest fee", 0, 1_200_000, false],
      ])
    })
  })

  it("with every sibling's fee set by hand, nobody is the full payer and each keeps its fee", () => {
    const preview = feePreview(family(yusuf, mariam), FEES, 2027, {}, {}, {
      1: own({ pays: 1_080_000, ...byHand }),
      2: own({ leadId: "m", fee: 1_100_000, pays: 1_100_000, ...byHand }),
    })
    expect(shown(preview)).toEqual([
      ["1", "Fee kept", 0.1, 1_080_000, false],
      ["2", "Fee kept", 0, 1_100_000, false],
    ])
    expect(preview!.total).toBe(2_180_000)
  })
})
