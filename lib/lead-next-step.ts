import type { Permission } from "@/lib/permissions"
import type { SchoolLevel } from "@/lib/result-messages"
import type { LeadFollowUps } from "@/lib/services/follow-ups"
import type { InterviewFeeStatus, InterviewResult, LeadInterview, RegistrationKind } from "@/lib/services/interviews"
import type { LeadFee } from "@/lib/services/lead-fees"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"
import type { LeadReopenings, ReopeningState } from "@/lib/services/reopening-requests"
import type { ReleaseBlocker, ReleaseStatus, ResultReleaseView } from "@/lib/services/result-release"
import type { Result } from "@/lib/services/result"
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
    // Whether the agreement of a Conditional result is marked signed.
    agreementSigned: boolean
  } | null
  // Which interview registration the lead takes now: "retake" after a
  // reopening for a retaken interview. Null when none, or unreadable.
  registration: RegistrationKind | null
  // The lead's latest approved reopening chose enrolling without a retaken
  // interview (enrolsWithoutRetake), so a Failed result no longer stands in
  // the way of School fee payments.
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
  // Conditional, and the head of school hasn't marked the agreement signed.
  | { kind: "sign-agreement" }
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

  // The family signs the agreement before paying the School fee.
  if (interview.result === "Conditional" && !interview.agreementSigned) return { kind: "sign-agreement" }
  if (interview.result === "Failed") {
    return dueOn !== null ? { kind: "wait-for-follow-up", dueOn } : { kind: "schedule-follow-up", reason: "failed" }
  }
  return schoolFeeStep(fee)
}

// Where the current result's release stands, for nextStep. The Result
// release view knows whether the result changed since it was sent only for
// staff who may send it, so the interview's release status, which everyone
// with leads.view reads, decides that when it could be read (#248).
export function releaseInput(
  view: Pick<ResultReleaseView, "blocked" | "latestRelease" | "changedSinceSent">,
  status: Pick<ReleaseStatus, "changedSinceSent"> | null,
): NonNullable<NextStepInput["release"]> {
  const sent = view.latestRelease !== null
  return {
    blocked: view.blocked,
    sent,
    changedSinceSent: sent && (status?.changedSinceSent ?? view.changedSinceSent),
  }
}

// The per-lead reads a next step is worked out from, one service call each.
// The record page passes its cached reads, so the panels share them; the
// tests pass the services themselves.
export type NextStepReaders = {
  interviews: (leadId: string) => Promise<Result<LeadInterview[], unknown>>
  registration: (leadId: string) => Promise<Result<RegistrationKind | null, unknown>>
  reopenings: (leadId: string) => Promise<Result<LeadReopenings, unknown>>
  release: (leadId: string) => Promise<Result<ResultReleaseView, unknown>>
  releaseStatus: (interviewId: string) => Promise<Result<Map<string, ReleaseStatus>, unknown>>
  followUps: (leadId: string) => Promise<Result<LeadFollowUps, unknown>>
}

// One lead's NextStepInput from its own reads: what the record's Next step
// card and the Applicants side sheet decide from. Null when the interviews
// can't be read, so the step can't be worked out. `feeRead` is the caller's
// read of the fee, so a caller that shows the fee too reads it once; null for
// staff who may not view payments. The Applicants list reads the same inputs
// for a whole page at once (lib/services/lead-next-steps.ts).
export async function readNextStepInput(
  read: NextStepReaders,
  lead: { id: string; status: LeadStatus; closure: LeadClosure | null },
  feeRead: Promise<Result<LeadFee, unknown>> | null,
  today: string,
): Promise<NextStepInput | null> {
  const [interviews, registration, reopenings, release, fee, followUps] = await Promise.all([
    read.interviews(lead.id),
    read.registration(lead.id),
    read.reopenings(lead.id),
    read.release(lead.id),
    feeRead,
    read.followUps(lead.id),
  ])
  if (!interviews.ok) return null

  // Once a result has gone, whether it changed since comes from the status
  // every viewer reads, not only those who may send it (#248).
  const sentFor = release.ok && release.data.latestRelease !== null ? release.data.interviewId : null
  const status = sentFor ? await read.releaseStatus(sentFor) : null
  const current = interviews.data[0] ?? null
  return {
    status: lead.status,
    closure: lead.closure,
    interview: current && {
      feeStatus: current.feeStatus,
      amount: current.amount,
      result: current.result,
      agreementSigned: current.agreementSignedAt !== null,
    },
    registration: registration.ok ? registration.data : null,
    enrolWithoutRetake: reopenings.ok && enrolsWithoutRetake(reopenings.data.decided),
    release: release.ok ? releaseInput(release.data, status?.ok && sentFor ? (status.data.get(sentFor) ?? null) : null) : null,
    fee: fee?.ok && fee.data.kind === "fee" ? { priority: fee.data.priority } : null,
    followUps: followUps.ok ? { dueOn: followUps.data.open?.dueOn ?? null, needsDate: followUps.data.needsDate } : null,
    today,
  }
}

function schoolFeeStep(fee: NextStepInput["fee"]): NextStep {
  if (fee === null) return { kind: "school-fee-unknown" }
  if (fee.priority === null) return { kind: "record-deposit" }
  return { kind: "collect-school-fee", priority: fee.priority }
}

// Whether payments may go ahead despite a Failed result: the latest approved
// reopening request chose Enrol without a retaken interview. A later approval
// without that choice takes it away. The database's rule is
// reopened_to_enrol, which check_school_fee_payment applies.
export function enrolsWithoutRetake(
  requests: readonly { state: ReopeningState; decidedAt: string | null; enrolWithoutRetake: boolean | null }[],
): boolean {
  const latest = requests
    .filter((request) => request.state === "approved" && request.decidedAt !== null)
    .reduce<(typeof requests)[number] | null>((newest, request) => (newest === null || request.decidedAt! > newest.decidedAt! ? request : newest), null)
  return latest?.enrolWithoutRetake === true
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

// The English name of the head whose office a level's families go to.
const HEAD_OF: Readonly<Record<SchoolLevel, string>> = { primary: "Head of Primary School", secondary: "Head of Secondary School" }

// What the Next step card says for a step. `formatDate` turns YYYY-MM-DD into
// the page's date format. `viewer` words the agreement step: for staff who
// may mark it, and the level that names the head; without it the step reads
// as it does to everyone else.
export function nextStepText(
  step: Exclude<NextStep, { kind: "closed" }>,
  formatDate: (date: string) => string,
  viewer: { canMarkAgreement?: boolean; schoolLevel?: SchoolLevel } = {},
): NextStepText {
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
            ? "The application was reopened and needs a follow-up date."
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
            detail: "The application was reopened for a retaken interview. Registering gives the student a new S/N.",
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
    case "sign-agreement": {
      const head = viewer.schoolLevel ? HEAD_OF[viewer.schoolLevel] : "head of school"
      return viewer.canMarkAgreement
        ? {
            title: "Get the agreement signed",
            detail: `Conditional result: the family signs the agreement at the ${head}'s office, then pays the School fee.`,
            action: { label: "Mark agreement signed", tab: "overview", anchor: "lead-next-step", permission: "agreements.mark" },
          }
        : {
            title: "Waiting for the agreement",
            detail: `The family signs at the ${head}'s office. The head marks it signed here; you can't.`,
            action: null,
          }
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
