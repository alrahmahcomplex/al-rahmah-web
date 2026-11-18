import { cache } from "react"

import { OFFICE_PHONE } from "@/lib/office"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { getInterviewRegistration, getLeadInterviews } from "@/lib/services/interviews"
import { getLeadFatherAndSchool } from "@/lib/services/lead-details"
import { getLeadFee } from "@/lib/services/lead-fees"
import { getLeadReopenings } from "@/lib/services/reopening-requests"
import { getResultRelease, listReleaseStatus } from "@/lib/services/result-release"
import type { Permission } from "@/lib/permissions"
import { createClient } from "@/utils/supabase/server"

import { readSiblingGroup } from "./sibling-read"

// Reads the Next step, the closed-lead banner and the panels share, each
// made once per page render however many of them ask.
export const readInterviews = cache(async (leadId: string) => getLeadInterviews(await createClient(), leadId))
export const readRelease = cache(async (leadId: string) =>
  getResultRelease(await createClient(), leadId, { officePhone: OFFICE_PHONE }),
)
export const readReleaseStatus = cache(async (interviewId: string) =>
  listReleaseStatus(await createClient(), [interviewId]),
)
export const readFee = cache(async (leadId: string) => getLeadFee(await createClient(), leadId))
export const readFollowUps = cache(async (leadId: string) => getLeadFollowUps(await createClient(), leadId))
export const readRegistration = cache(async (leadId: string) => getInterviewRegistration(await createClient(), leadId))
export const readReopenings = cache(async (leadId: string) => getLeadReopenings(await createClient(), leadId))
export const readFatherAndSchool = cache(async (leadId: string) => getLeadFatherAndSchool(await createClient(), leadId))
// The permissions joined with commas, so one page render reads the group once.
export const readSiblingView = cache(async (leadId: string, permissions: string) =>
  readSiblingGroup(await createClient(), leadId, permissions.split(",") as Permission[]),
)
