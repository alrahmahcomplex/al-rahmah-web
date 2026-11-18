import { describe, expect, it } from "vitest"

import { checkInStudents, familyName, formName, givenRelationship, personParts, startCheckIn } from "@/app/staff/check-in/[id]/model"
import { payload } from "@/app/staff/check-in/new/model"
import type { AdmissionFormFamily, FormChild } from "@/lib/services/admission-form-family"

// Check-in of an Admission form family (#309): it starts from what the form
// gave, and asks only the rest.

const child = (more: Partial<FormChild> = {}): FormChild => ({
  leadId: "11111111-1111-4111-8111-111111111111",
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
  ...more,
})

const family = (children: FormChild[]): AdmissionFormFamily => ({
  sentOn: "2026-11-09",
  contact: {
    id: "c0a70000-0000-4000-8000-000000000309",
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
    expect(checkIn.contact).toMatchObject({ relationship: "Mother", contact: { id: "c0a70000-0000-4000-8000-000000000309", fullName: "SAIDA OMARI HASSAN" } })
    expect(checkIn.contact?.contact.children).toEqual([expect.objectContaining({ id: "o1", fatherFullName: "ALI OMARI HASSAN" })])
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
  const linked = child({ leadId: "22222222-2222-4222-8222-222222222222", studentName: "MARIAM ALI HASSAN", className: "STD 1", linked: true })
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
