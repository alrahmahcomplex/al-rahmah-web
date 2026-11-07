import { cache } from "react"

import { OFFICE_PHONE } from "@/lib/office"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { getLeadInterviews } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { getResultRelease } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

// Reads the Next step and the Overview cards share, each made once per page
// render however many of them ask.
export const readInterviews = cache(async (leadId: string) => getLeadInterviews(await createClient(), leadId))
export const readRelease = cache(async (leadId: string) =>
  getResultRelease(await createClient(), leadId, { officePhone: OFFICE_PHONE }),
)
export const readFee = cache(async (leadId: string) => getLeadFee(await createClient(), leadId))
export const readFollowUps = cache(async (leadId: string) => getLeadFollowUps(await createClient(), leadId))
