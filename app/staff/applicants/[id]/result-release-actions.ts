"use server"

import { revalidatePath } from "next/cache"

import { OFFICE_PHONE } from "@/lib/office"
import { releaseResult } from "@/lib/services/result-release"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { releaseRefusal, smsNote, type ReleaseOutcome, type SmsReleaseOutcome } from "./result-release-outcome"

// Releases the lead's current result by WhatsApp: records the release, then
// hands back the wa.me link for the tab the click opened. A POST, so the
// message and the link never appear in our own URLs, and nothing here logs
// them. The database checks the permission and the whole gate again.
// seenReleases is how many releases the page showed; a send from a page that
// saw fewer than exist is refused, as someone else sent it meanwhile.
export async function sendResultByWhatsApp(
  leadId: string,
  interviewId: string,
  seenReleases: number,
): Promise<ReleaseOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string") return releaseRefusal("not-found")
  if (!isCount(seenReleases)) return releaseRefusal("sent_meanwhile")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "results.send")
  if (!allowed.ok) return releaseRefusal("forbidden")

  const released = await releaseResult(supabase, interviewId, "whatsapp", { officePhone: OFFICE_PHONE, seenReleases })
  if (!released.ok) return releaseRefusal(released.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  if (released.data.channel !== "whatsapp") return releaseRefusal("unavailable")
  return { status: "released", link: released.data.link }
}

// Releases the lead's current result by SMS: records the release, then hands
// back the short text and the direct phone for staff to send from the office
// phone. Allowed whether or not WhatsApp is offered. Refused like WhatsApp
// when the page saw fewer releases than exist.
export async function sendResultBySms(
  leadId: string,
  interviewId: string,
  seenReleases: number,
): Promise<SmsReleaseOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string") return releaseRefusal("not-found")
  if (!isCount(seenReleases)) return releaseRefusal("sent_meanwhile")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "results.send")
  if (!allowed.ok) return releaseRefusal("forbidden")

  const released = await releaseResult(supabase, interviewId, "sms", { officePhone: OFFICE_PHONE, seenReleases })
  if (!released.ok) return releaseRefusal(released.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  if (released.data.channel !== "sms") return releaseRefusal("unavailable")
  const { text, phone } = released.data
  return { status: "released", text, phone, note: smsNote(released.data) }
}

// A release count from the page. Anything else is refused like a page that
// missed a release, which a reload fixes.
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
