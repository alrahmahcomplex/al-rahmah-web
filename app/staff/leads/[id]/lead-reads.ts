import { cache } from "react"

import { OFFICE_PHONE } from "@/lib/office"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { getInterviewRegistration, getLeadInterviews } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { getLeadReopenings } from "@/lib/services/reopening-requests"
import { getResultRelease } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

// Reads the Next step, the closed-lead banner and the panels share, each
// made once per page render however many of them ask.
export const readInterviews = cache(async (leadId: string) => getLeadInterviews(await createClient(), leadId))
export const readRelease = cache(async (leadId: string) =>
  getResultRelease(await createClient(), leadId, { officePhone: OFFICE_PHONE }),
)
export const readFee = cache(async (leadId: string) => getLeadFee(await createClient(), leadId))
export const readFollowUps = cache(async (leadId: string) => getLeadFollowUps(await createClient(), leadId))
export const readRegistration = cache(async (leadId: string) => getInterviewRegistration(await createClient(), leadId))
export const readReopenings = cache(async (leadId: string) => getLeadReopenings(await createClient(), leadId))
