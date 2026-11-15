import { nextStep, readNextStepInput, type NextStep } from "@/lib/lead-next-step"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"

import { readFee, readFollowUps, readInterviews, readRegistration, readRelease, readReleaseStatus, readReopenings } from "./lead-reads"

// The lead's next step (lib/lead-next-step) from what the lead page reads,
// for the record's Next step card and the Applicants side sheet. Null when
// the interviews can't be read, so the step can't be worked out. `feeRead`
// is the caller's read of the fee (readFee), so a caller that shows the fee
// too reads it once; null for staff who may not view payments.
export async function readNextStep(lead: Lead, feeRead: ReturnType<typeof readFee> | null): Promise<NextStep | null> {
  const input = await readNextStepInput(
    {
      interviews: readInterviews,
      registration: readRegistration,
      reopenings: readReopenings,
      release: readRelease,
      releaseStatus: readReleaseStatus,
      followUps: readFollowUps,
    },
    lead,
    feeRead,
    tanzaniaToday(),
  )
  return input && nextStep(input)
}
