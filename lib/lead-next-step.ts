import type { Permission } from "@/lib/permissions"
import type { InterviewFeeStatus, InterviewResult, RegistrationKind } from "@/lib/services/interviews"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"
import type { ReleaseBlocker } from "@/lib/services/result-release"
import type { SeatPriority } from "@/lib/services/school-fee-payments"

// The one thing that should happen next on a lead, read from its lifecycle
// (CONTEXT.md, Lead Lifecycle) and what the lead page already reads. It
// decides nothing the database enforces: the action it points at is still
// gated by its own permission and checks.

export type NextStepInput = {
  status: LeadStatus
  closure: LeadClosure | null
  // The current interview, or null before the lead is registered for one.
  interview: {
    feeStatus: InterviewFeeStatus
    // Whole TZS still to pay while Not Paid.
    amount: number
    result: InterviewResult | null
  } | null
  // Which interview registration the lead takes now: "retake" after a
  // reopening for a retaken interview. Null when none, or unreadable.
  registration: RegistrationKind | null
  // The latest reopening from Declined approved enrolling without a retaken
  // interview, so a Failed result no longer stands in the way.
  enrolWithoutRetake: boolean
  // Where the current result's release stands; null when it couldn't be read.
  release: { blocked: ReleaseBlocker | null; sent: boolean; changedSinceSent: boolean } | null
  // The School fee's Seat priority; null when the fee can't be read, as for
  // staff without payments.view or a year with no Fee schedule.
  fee: { priority: SeatPriority | null } | null
  // The open follow-up, and whether a reopened lead still needs a date; null
  // when the follow-ups couldn't be read.
  followUps: { dueOn: string | null; needsDate: boolean } | null
  // YYYY-MM-DD in Tanzania.
  today: string
}

export type NextStep =
  // Declined, Inactive or Archived: the page shows the closed banner instead.
  | { kind: "closed" }
  | { kind: "enrolled" }
  | { kind: "record-follow-up"; dueOn: string; overdue: boolean }
  | { kind: "schedule-follow-up"; reason: "reopened" | "failed" }
  | { kind: "record-visit" }
  | { kind: "register-interview"; retake: boolean }
  | { kind: "collect-interview-fee"; amount: number }
  | { kind: "record-result" }
  | { kind: "send-result"; corrected: boolean }
  | { kind: "wait-for-follow-up"; dueOn: string }
  | { kind: "record-deposit" }
  | { kind: "collect-school-fee"; priority: SeatPriority }
  // Passed, but the School fee can't be read here.
  | { kind: "school-fee-unknown" }

export function nextStep(input: NextStepInput): NextStep {
  const { status, closure, interview, registration, enrolWithoutRetake, release, fee, followUps, today } = input
  if (status === "Declined" || closure !== null) return { kind: "closed" }
  if (status === "Enrolled") return { kind: "enrolled" }

  // A follow-up that has come due is a promise to the family: it goes first.
  const dueOn = followUps?.dueOn ?? null
  if (dueOn !== null && dueOn <= today) return { kind: "record-follow-up", dueOn, overdue: dueOn < today }
  if (followUps?.needsDate) return { kind: "schedule-follow-up", reason: "reopened" }

  if (status === "Applied") return { kind: "record-visit" }
  if (interview === null || registration === "retake") {
    return { kind: "register-interview", retake: registration === "retake" }
  }
  // Approved to enrol without a retaken interview: straight to the School fee.
  if (enrolWithoutRetake) return schoolFeeStep(fee)
  if (interview.feeStatus !== "Paid") return { kind: "collect-interview-fee", amount: interview.amount }
  if (interview.result === null) return { kind: "record-result" }
  if (release !== null && release.blocked === null && (!release.sent || release.changedSinceSent)) {
    return { kind: "send-result", corrected: release.sent }
  }

  if (interview.result === "Failed") {
    return dueOn !== null ? { kind: "wait-for-follow-up", dueOn } : { kind: "schedule-follow-up", reason: "failed" }
  }
  return schoolFeeStep(fee)
}

function schoolFeeStep(fee: NextStepInput["fee"]): NextStep {
  if (fee === null) return { kind: "school-fee-unknown" }
  if (fee.priority === null) return { kind: "record-deposit" }
  return { kind: "collect-school-fee", priority: fee.priority }
}

export type NextStepTab = "overview" | "interview" | "school-fee" | "follow-ups"

export type NextStepText = {
  title: string
  detail: string
  // Where the work is done, and who may do it. Null when nothing is waiting.
  action: { label: string; tab: NextStepTab; anchor: string; permission: Permission } | null
}

function tzs(amount: number) {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// What the Next step card says for a step. `formatDate` turns YYYY-MM-DD into
// the page's date format.
export function nextStepText(step: Exclude<NextStep, { kind: "closed" }>, formatDate: (date: string) => string): NextStepText {
  switch (step.kind) {
    case "enrolled":
      return {
        title: "Nothing is waiting",
        detail: "The student is Enrolled. Payments and follow-ups stay on their tabs.",
        action: null,
      }
    case "record-follow-up":
      return {
        title: step.overdue ? "Record the overdue follow-up" : "Record today's follow-up",
        detail: `The follow-up planned for ${formatDate(step.dueOn)} is ${step.overdue ? "overdue" : "due today"}. Contact the family and record how it went.`,
        action: { label: "Record follow-up", tab: "follow-ups", anchor: "lead-follow-ups", permission: "follow_ups.record" },
      }
    case "schedule-follow-up":
      return {
        title: "Set the next follow-up date",
        detail:
          step.reason === "reopened"
            ? "The lead was reopened and needs a follow-up date."
            : "The student did not pass and the result has gone to the family. Plan when to talk to them about a retake.",
        action: { label: "Schedule follow-up", tab: "follow-ups", anchor: "lead-follow-ups", permission: "follow_ups.record" },
      }
    case "record-visit":
      return {
        title: "Record the visit",
        detail: "The family applied through the Admission form and hasn't visited yet.",
        action: { label: "Record visit", tab: "overview", anchor: "lead-next-step", permission: "visits.record" },
      }
    case "register-interview":
      return step.retake
        ? {
            title: "Register the retaken interview",
            detail: "The lead was reopened for a retaken interview. Registering gives the student a new S/N.",
            action: { label: "Register retaken interview", tab: "interview", anchor: "lead-interview", permission: "interviews.record" },
          }
        : {
            title: "Register for interview",
            detail: "The family has visited. Registering gives the student an S/N on the interview list.",
            action: { label: "Register for interview", tab: "interview", anchor: "lead-interview", permission: "interviews.record" },
          }
    case "collect-interview-fee":
      return {
        title: `Collect the interview fee, ${tzs(step.amount)}`,
        detail: "The result can go to the family once the Accountant marks the fee Paid.",
        action: { label: "Record interview fee", tab: "interview", anchor: "lead-interview", permission: "interview_payments.record" },
      }
    case "record-result":
      return {
        title: "Record the interview result",
        detail: "The interview fee is Paid. Record the result and score once the interview is marked.",
        action: { label: "Record result", tab: "interview", anchor: "lead-interview", permission: "interviews.record" },
      }
    case "send-result":
      return {
        title: step.corrected ? "Send the corrected result" : "Send the result to the family",
        detail: step.corrected
          ? "The result or score changed after it was sent. Send the corrected one."
          : "The result is recorded and the fee is Paid, so it can go to the family now.",
        action: { label: "Send result", tab: "interview", anchor: "result-release", permission: "results.send" },
      }
    case "wait-for-follow-up":
      return {
        title: `Follow up on ${formatDate(step.dueOn)}`,
        detail: "The student did not pass and the family has the result. Nothing is due before the follow-up.",
        action: null,
      }
    case "record-deposit":
      return {
        title: "Collect the Initial deposit",
        detail: "The student may enrol. The deposit gives the student a Seat priority.",
        action: { label: "Record payment", tab: "school-fee", anchor: "lead-school-fee", permission: "payments.record" },
      }
    case "collect-school-fee":
      return {
        title: "Collect the next School fee instalment",
        detail:
          step.priority === "Deposit"
            ? "Seat priority is Deposit. Paying 40% of the fee reaches First instalment."
            : "Seat priority is First instalment. The student is Enrolled from the Academic-year start, or once the fee is paid in full.",
        action: { label: "Record payment", tab: "school-fee", anchor: "lead-school-fee", permission: "payments.record" },
      }
    case "school-fee-unknown":
      return {
        title: "Collect the School fee",
        detail: "The student may enrol. Staff who see payments can tell how much is paid.",
        action: null,
      }
  }
}
