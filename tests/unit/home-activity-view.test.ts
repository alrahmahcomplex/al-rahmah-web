import { describe, expect, it } from "vitest"

import { activityView, dayOf, listed, timeOf, type ActivityContext } from "@/app/staff/_home/activity"
import type { Permission } from "@/lib/permissions"
import type { ActivityRow } from "@/lib/services/home-activity"

// The Admissions Manager and Admissions Staff templates' permissions that the
// log's buttons read (CONTEXT.md, Permissions).
const OFFICER: Permission[] = ["leads.view", "leads.create", "leads.edit", "visits.record", "results.send", "follow_ups.record", "payments.view"]
const MANAGER: Permission[] = [...OFFICER, "discounts.approve", "agents.approve", "academic_years.manage"]
const ACCOUNTANT: Permission[] = ["leads.view", "payments.view", "payments.record", "interview_payments.record"]

const TODAY = "2026-11-15"
const as = (permissions: Permission[]): ActivityContext => ({ today: TODAY, permissions })
// 08:05 in Tanzania.
const AT = "2026-11-15T05:05:00Z"
const LEAD = { leadId: "l1", admissionNumber: "ADMSN-12345", studentName: "AMANI DAUDI PETRO", className: "KG 2" as const }

describe("the time column", () => {
  it("shows today's clock time in Tanzania and an earlier day as its date", () => {
    expect(timeOf(AT, TODAY)).toBe("08:05")
    // 23:30 in Tanzania on 14 November is still the day before.
    expect(timeOf("2026-11-14T20:30:00Z", TODAY)).toBe("14 Nov")
    // 00:10 in Tanzania on 15 November, though still the 14th in UTC.
    expect(timeOf("2026-11-14T21:10:00Z", TODAY)).toBe("00:10")
  })

  it("shows a date as Today or the date", () => {
    expect(dayOf(TODAY, TODAY)).toBe("Today")
    expect(dayOf("2026-11-06", TODAY)).toBe("6 Nov")
  })
})

describe("what each row says", () => {
  it("lists names with and", () => {
    expect(listed(["YUSUF"])).toBe("YUSUF")
    expect(listed(["YUSUF", "MARIAM"])).toBe("YUSUF and MARIAM")
    expect(listed(["A", "B", "C"])).toBe("A, B and C")
  })

  it("expected at the desk: all day, every waiting child, Check in for those who record visits", () => {
    const row: ActivityRow = {
      kind: "expected",
      id: "s1",
      at: AT,
      sentOn: "2026-11-09",
      children: [LEAD, { ...LEAD, leadId: "l2", studentName: "MARIAM ALI", className: "STD 1" }],
    }
    expect(activityView(row, as(OFFICER))).toMatchObject({
      time: "All day",
      task: "Expected at the desk",
      who: "AMANI DAUDI PETRO and MARIAM ALI",
      about: "KG 2 and STD 1",
      details: "Sent the Admission form on 9 November. Check them in when they arrive.",
      action: { label: "Check in", href: "/staff/applicants/l1" },
      recordedBy: "Admission form",
    })
    expect(activityView(row, as(ACCOUNTANT)).action).toBeNull()
  })

  it("new application: with or without a Discount code, and no call once the lead is closed", () => {
    const row: ActivityRow = { kind: "new_application", id: "l1", at: AT, ...LEAD, referralCode: null, status: "Applied", closure: null }
    expect(activityView(row, as(OFFICER))).toMatchObject({
      time: "08:05",
      details: "Sent from the Admission form, no Discount code. Invite the family to the school.",
      action: { label: "Call the family", href: "/staff/applicants/l1?tab=follow-ups#lead-follow-ups" },
    })
    expect(activityView({ ...row, referralCode: "AAN-132" }, as(OFFICER)).details).toBe(
      "Sent from the Admission form with Discount code AAN-132. Invite the family to the school.",
    )
    expect(activityView({ ...row, closure: "Archived" }, as(OFFICER)).action).toBeNull()
  })

  it("result ready: never sent or changed since, for staff who send results", () => {
    const row: ActivityRow = { kind: "result_ready", id: "i1", at: AT, ...LEAD, interviewDate: TODAY, result: "Passed", score: 78, changedSinceSent: false }
    expect(activityView(row, as(OFFICER))).toMatchObject({
      time: "Today",
      details: "Passed with 78%. The family hasn’t been told yet.",
      action: { label: "Release the result", href: "/staff/applicants/l1?tab=interview#result-release" },
      recordedBy: null,
    })
    expect(activityView({ ...row, interviewDate: "2026-11-05", score: 82.5, changedSinceSent: true }, as(OFFICER))).toMatchObject({
      time: "5 Nov",
      details: "Passed with 82.5%. The family has the earlier result. Send the corrected one.",
    })
    expect(activityView(row, as(ACCOUNTANT)).action).toBeNull()
  })

  it("discount requests: the Manager decides Staff child and Qualified orphan here; nobody decides a Sibling request here yet", () => {
    const row: ActivityRow = {
      kind: "discount_request",
      id: "r1",
      at: AT,
      ...LEAD,
      discount: "staff_child",
      note: "the custodian is on the teaching staff.",
      requestedBy: "Example Staff One",
    }
    expect(activityView(row, as(MANAGER))).toMatchObject({
      task: "Staff child discount request",
      details: "Staff child 25%: the custodian is on the teaching staff.",
      action: { label: "Approve or refuse", href: "/staff/discounts" },
      recordedBy: "Example Staff One",
      note: { tone: "wait", text: "You can approve or refuse this request." },
    })
    expect(activityView(row, as(OFFICER))).toMatchObject({ action: null, note: { text: "Only the Admissions Manager can approve this." } })
    const sibling = activityView({ ...row, discount: "sibling", note: "fathers’ names don’t match." }, as(MANAGER))
    expect(sibling).toMatchObject({ task: "Sibling discount request", details: "Sibling 10%: fathers’ names don’t match.", action: null })
    expect(activityView({ ...row, discount: "qualified_orphan" }, as(MANAGER)).details).toMatch(/^Qualified orphan 100%: /)
  })

  it("a claimed Discount code goes to the claim queue", () => {
    const row: ActivityRow = { kind: "agent_claim", id: "a1", at: AT, agentId: "a1", fullName: "MWALIMU EXAMPLE THREE", code: "MET-123", claims: 1 }
    expect(activityView(row, as(MANAGER))).toMatchObject({
      task: "Discount code claimed",
      who: "MWALIMU EXAMPLE THREE",
      about: "MET-123",
      action: { label: "Confirm the code", href: "/staff/agents?status=all&account=awaiting-confirmation" },
      recordedBy: "Discount code sign-up",
    })
  })

  it("a re-application names a changed class, and opens the review", () => {
    const row: ActivityRow = { kind: "re_application", id: "x1", at: AT, ...LEAD, className: "STD 7", askedClass: "FORM 1", differingFields: ["class_name"] }
    expect(activityView(row, as(OFFICER))).toMatchObject({
      details: "Sent the form again and asks for FORM 1 instead of STD 7.",
      action: { label: "Review", href: "/staff/re-applications/x1" },
    })
    expect(activityView({ ...row, differingFields: ["phone"] }, as(OFFICER)).details).toBe("Sent the form again.")
  })

  it("a paid school fee gives the amount and type, and no button", () => {
    const row: ActivityRow = { kind: "fee_paid", id: "p1", at: AT, ...LEAD, paymentType: "first_instalment", amount: 600000, recordedBy: "Example Accountant" }
    expect(activityView(row, as(MANAGER))).toMatchObject({ details: "TZS 600,000, first instalment.", action: null, recordedBy: "Example Accountant" })
  })

  it("a call back names the custodian and the child, overdue or due today", () => {
    const row: ActivityRow = {
      kind: "call_back",
      id: "f1",
      at: AT,
      ...LEAD,
      studentName: "AMANI DAUDI PETRO",
      dueOn: "2026-11-06",
      note: "book Amani’s interview.",
      custodianName: "DAUDI PETRO AMANI",
      relationship: "Father",
      relationshipDescription: null,
    }
    expect(activityView(row, as(OFFICER))).toMatchObject({
      time: "6 Nov",
      who: "DAUDI PETRO AMANI",
      about: "father of AMANI",
      details: "Overdue since 6 November: book Amani’s interview.",
      action: { label: "Call", href: "/staff/applicants/l1?tab=follow-ups#lead-follow-ups" },
      recordedBy: null,
    })
    expect(activityView({ ...row, dueOn: TODAY, note: null }, as(OFFICER))).toMatchObject({ time: "Today", details: "Due today." })
    expect(activityView({ ...row, relationship: "Other", relationshipDescription: "Uncle" }, as(OFFICER)).about).toBe("uncle of AMANI")
  })

  it("a full class opens Seats", () => {
    const row: ActivityRow = { kind: "class_full", id: "STD 6", className: "STD 6", taken: 35, seats: 35 }
    expect(activityView(row, as(MANAGER))).toMatchObject({
      time: "All day",
      task: "Class is full",
      who: "STD 6",
      about: "35 of 35 seats",
      details: "No seats left. Open Seats to see who holds them.",
      action: { label: "Open Seats", href: "/staff/seats" },
    })
  })
})
