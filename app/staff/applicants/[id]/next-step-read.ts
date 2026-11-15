import { enrolsWithoutRetake, nextStep, releaseInput, type NextStep } from "@/lib/lead-next-step"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"

import { readFee, readFollowUps, readInterviews, readRegistration, readRelease, readReleaseStatus, readReopenings } from "./lead-reads"

// The lead's next step (lib/lead-next-step) from what the lead page reads,
// for the record's Next step card and the Applicants side sheet. Null when
// the interviews can't be read, so the step can't be worked out. The fee
// counts only for staff who may view payments.
export async function readNextStep(lead: Lead, canSeeFee: boolean): Promise<NextStep | null> {
  const [interviews, registration, reopenings, release, fee, followUps] = await Promise.all([
    readInterviews(lead.id),
    readRegistration(lead.id),
    readReopenings(lead.id),
    readRelease(lead.id),
    canSeeFee ? readFee(lead.id) : null,
    readFollowUps(lead.id),
  ])
  if (!interviews.ok) return null

  // Once a result has gone, whether it changed since comes from the status
  // every viewer reads, not only those who may send it (#248).
  const sentFor = release.ok && release.data.latestRelease !== null ? release.data.interviewId : null
  const status = sentFor ? await readReleaseStatus(sentFor) : null
  const current = interviews.data[0] ?? null
  return nextStep({
    status: lead.status,
    closure: lead.closure,
    interview: current && { feeStatus: current.feeStatus, amount: current.amount, result: current.result },
    registration: registration.ok ? registration.data : null,
    enrolWithoutRetake: reopenings.ok && enrolsWithoutRetake(reopenings.data.decided),
    release: release.ok ? releaseInput(release.data, status?.ok && sentFor ? (status.data.get(sentFor) ?? null) : null) : null,
    fee: fee?.ok && fee.data.kind === "fee" ? { priority: fee.data.priority } : null,
    followUps: followUps.ok ? { dueOn: followUps.data.open?.dueOn ?? null, needsDate: followUps.data.needsDate } : null,
    today: tanzaniaToday(),
  })
}
