import { describe, expect, it } from "vitest"

import { nextStep, nextStepText, type NextStep, type NextStepInput } from "@/lib/lead-next-step"
import { formatDate } from "@/lib/school-calendar"

const TODAY = "2026-11-07"

// A Visited lead with nothing else on it.
function lead(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    status: "Visited",
    closure: null,
    interview: null,
    registration: null,
    enrolWithoutRetake: false,
    release: null,
    fee: { priority: null },
    followUps: { dueOn: null, needsDate: false },
    today: TODAY,
    ...overrides,
  }
}

const UNPAID = { feeStatus: "Not Paid", amount: 50000, result: null } as const
const PAID = { feeStatus: "Paid", amount: 50000, result: null } as const
const PASSED = { feeStatus: "Paid", amount: 50000, result: "Passed" } as const
const FAILED = { feeStatus: "Paid", amount: 50000, result: "Failed" } as const
const SENT = { blocked: null, sent: true, changedSinceSent: false } as const

describe("the next step on a lead", () => {
  it("is the closed banner for a Declined lead or one with a closure mark", () => {
    expect(nextStep(lead({ status: "Declined" }))).toEqual({ kind: "closed" })
    expect(nextStep(lead({ closure: "Inactive" }))).toEqual({ kind: "closed" })
    expect(nextStep(lead({ status: "Enrolled", closure: "Archived" }))).toEqual({ kind: "closed" })
  })

  it("is nothing for an Enrolled lead, even with a follow-up due", () => {
    expect(nextStep(lead({ status: "Enrolled", followUps: { dueOn: "2026-11-01", needsDate: false } }))).toEqual({
      kind: "enrolled",
    })
  })

  it("puts a follow-up that has come due first, today's or overdue", () => {
    const overdue = lead({ status: "Applied", followUps: { dueOn: "2026-11-06", needsDate: false } })
    expect(nextStep(overdue)).toEqual({ kind: "record-follow-up", dueOn: "2026-11-06", overdue: true })
    const today = lead({ interview: UNPAID, followUps: { dueOn: TODAY, needsDate: false } })
    expect(nextStep(today)).toEqual({ kind: "record-follow-up", dueOn: TODAY, overdue: false })
  })

  it("leaves a follow-up still to come for later", () => {
    expect(nextStep(lead({ followUps: { dueOn: "2026-11-08", needsDate: false } }))).toEqual({ kind: "register-interview", retake: false })
  })

  it("asks a reopened lead for a follow-up date", () => {
    expect(nextStep(lead({ interview: UNPAID, followUps: { dueOn: null, needsDate: true } }))).toEqual({
      kind: "schedule-follow-up",
      reason: "reopened",
    })
  })

  it("records the visit of an Applied lead", () => {
    expect(nextStep(lead({ status: "Applied" }))).toEqual({ kind: "record-visit" })
  })

  it("registers a Visited lead with no interview", () => {
    expect(nextStep(lead())).toEqual({ kind: "register-interview", retake: false })
  })

  it("registers the retaken interview after a reopening for a retake, whatever the old interview says", () => {
    const reopened = lead({
      status: "Interviewed",
      interview: FAILED,
      registration: "retake",
      release: SENT,
      followUps: { dueOn: "2026-11-20", needsDate: false },
    })
    expect(nextStep(reopened)).toEqual({ kind: "register-interview", retake: true })
  })

  it("goes straight to the School fee once enrolling without a retaken interview is approved", () => {
    const approved = { status: "Interviewed", interview: FAILED, release: SENT, enrolWithoutRetake: true } as const
    const planned = { dueOn: "2026-11-20", needsDate: false }
    expect(nextStep(lead({ ...approved, followUps: planned }))).toEqual({ kind: "record-deposit" })
    expect(nextStep(lead({ ...approved, fee: { priority: "Deposit" } }))).toEqual({
      kind: "collect-school-fee",
      priority: "Deposit",
    })
  })

  it("collects the interview fee before anything else on the interview, with the amount", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: { ...UNPAID, result: "Passed" } }))).toEqual({
      kind: "collect-interview-fee",
      amount: 50000,
    })
  })

  it("records the result once the fee is Paid", () => {
    expect(nextStep(lead({ interview: PAID }))).toEqual({ kind: "record-result" })
  })

  it("sends a result that hasn't gone, and a corrected one again", () => {
    const ready = { blocked: null, sent: false, changedSinceSent: false }
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: ready }))).toEqual({
      kind: "send-result",
      corrected: false,
    })
    const changed = { blocked: null, sent: true, changedSinceSent: true }
    expect(nextStep(lead({ status: "Interviewed", interview: FAILED, release: changed }))).toEqual({
      kind: "send-result",
      corrected: true,
    })
  })

  it("skips sending when the release can't be read or is blocked", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: null }))).toEqual({ kind: "record-deposit" })
    const blocked = { blocked: "lead_closed", sent: false, changedSinceSent: false } as const
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: blocked }))).toEqual({ kind: "record-deposit" })
  })

  it("plans a follow-up after a Failed result went out, or waits for the one planned", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: FAILED, release: SENT }))).toEqual({
      kind: "schedule-follow-up",
      reason: "failed",
    })
    const planned = { dueOn: "2026-11-20", needsDate: false }
    expect(nextStep(lead({ status: "Interviewed", interview: FAILED, release: SENT, followUps: planned }))).toEqual({
      kind: "wait-for-follow-up",
      dueOn: "2026-11-20",
    })
  })

  it("collects the Initial deposit from a Passed lead with no Seat priority", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: SENT }))).toEqual({ kind: "record-deposit" })
  })

  it("collects the rest of the School fee from a lead with a priority short of Enrolled", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: SENT, fee: { priority: "Deposit" } }))).toEqual({
      kind: "collect-school-fee",
      priority: "Deposit",
    })
  })

  it("can't say how much is paid when the School fee can't be read", () => {
    expect(nextStep(lead({ status: "Interviewed", interview: PASSED, release: SENT, fee: null }))).toEqual({
      kind: "school-fee-unknown",
    })
  })

  it("treats unreadable follow-ups as none due", () => {
    expect(nextStep(lead({ followUps: null }))).toEqual({ kind: "register-interview", retake: false })
  })
})

describe("the Next step card's text", () => {
  const every: Exclude<NextStep, { kind: "closed" }>[] = [
    { kind: "enrolled" },
    { kind: "record-follow-up", dueOn: "2026-11-06", overdue: true },
    { kind: "record-follow-up", dueOn: TODAY, overdue: false },
    { kind: "schedule-follow-up", reason: "reopened" },
    { kind: "schedule-follow-up", reason: "failed" },
    { kind: "record-visit" },
    { kind: "register-interview", retake: false },
    { kind: "register-interview", retake: true },
    { kind: "collect-interview-fee", amount: 50000 },
    { kind: "record-result" },
    { kind: "send-result", corrected: false },
    { kind: "send-result", corrected: true },
    { kind: "wait-for-follow-up", dueOn: "2026-11-20" },
    { kind: "record-deposit" },
    { kind: "collect-school-fee", priority: "Deposit" },
    { kind: "collect-school-fee", priority: "First instalment" },
    { kind: "school-fee-unknown" },
  ]

  it("gives every step a title and an explanation", () => {
    for (const step of every) {
      const text = nextStepText(step, formatDate)
      expect(text.title, step.kind).not.toBe("")
      expect(text.detail, step.kind).not.toBe("")
    }
  })

  it("names the interview fee with its amount, as Rukia Maandalizi's page shows it", () => {
    expect(nextStepText({ kind: "collect-interview-fee", amount: 50000 }, formatDate)).toMatchObject({
      title: "Collect the interview fee, TZS 50,000",
      action: { tab: "interview", permission: "interview_payments.record" },
    })
  })

  it("says nothing is waiting on an Enrolled lead, with no action", () => {
    expect(nextStepText({ kind: "enrolled" }, formatDate)).toMatchObject({ title: "Nothing is waiting", action: null })
  })

  it("points each action at the tab and permission that do it", () => {
    const actions = every.map((step) => [step.kind, nextStepText(step, formatDate).action] as const)
    expect(Object.fromEntries(actions.map(([kind, action]) => [kind, action && `${action.tab} ${action.permission}`]))).toEqual({
      enrolled: null,
      "record-follow-up": "follow-ups follow_ups.record",
      "schedule-follow-up": "follow-ups follow_ups.record",
      "record-visit": "overview visits.record",
      "register-interview": "interview interviews.record",
      "collect-interview-fee": "interview interview_payments.record",
      "record-result": "interview interviews.record",
      "send-result": "interview results.send",
      "wait-for-follow-up": null,
      "record-deposit": "school-fee payments.record",
      "collect-school-fee": "school-fee payments.record",
      "school-fee-unknown": null,
    })
  })

  it("names a retaken interview's registration", () => {
    expect(nextStepText({ kind: "register-interview", retake: true }, formatDate)).toMatchObject({
      title: "Register the retaken interview",
      action: { label: "Register retaken interview", tab: "interview" },
    })
  })

  it("dates follow-ups in the page's format", () => {
    expect(nextStepText({ kind: "record-follow-up", dueOn: "2026-11-06", overdue: true }, formatDate).detail).toContain(
      "6 Nov 2026",
    )
    expect(nextStepText({ kind: "wait-for-follow-up", dueOn: "2026-11-20" }, formatDate).title).toBe("Follow up on 20 Nov 2026")
  })
})
