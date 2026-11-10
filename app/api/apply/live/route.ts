import type { LiveApply } from "@/lib/live-apply"
import { getAdmissionApplicationCount } from "@/lib/services/admission-applications"
import { getInterviewDiscount } from "@/lib/services/referral"
import { publicFormClient } from "@/utils/supabase/public-form"

// The public Admission form's live figures: this year's application count and
// the interview discount, as `{ applications, discount }`. The page renders
// without Supabase and polls this every 30 seconds once it is up.
//
// It returns two aggregate numbers and nothing else, reads them with the
// secret key on the server, needs no session and writes nothing. It reads no
// cookie or body and logs nothing about the visitor. Either field is null when
// Supabase is missing, down or slower than 2 seconds. The count is the raw
// total; the form applies MIN_SHOWN_APPLICATIONS.
//
// There is no rate limit: the CDN keeps one answer for 30 seconds, so however
// many visitors poll, Supabase sees about two reads a minute per region.
// Outside proxy.ts's matcher, so it answers when the staff session can't.

export const dynamic = "force-dynamic"

const CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=120"

// The secret-key client, or null when it is not configured, so a missing
// Supabase URL answers nulls like a missing key does.
function client() {
  try {
    return publicFormClient()
  } catch (error) {
    console.error("Live Admission form figures: no Supabase client", error)
    return null
  }
}

export async function GET(): Promise<Response> {
  const supabase = client()
  let body: LiveApply = { applications: null, discount: null }
  if (supabase) {
    const [count, discount] = await Promise.all([
      getAdmissionApplicationCount(supabase).catch(() => null),
      getInterviewDiscount(supabase).catch(() => null),
    ])
    body = {
      applications: count?.ok ? count.data : null,
      discount: discount?.ok ? discount.data : null,
    }
  }
  return new Response(JSON.stringify(body), {
    headers: { "Cache-Control": CACHE_CONTROL, "Content-Type": "application/json" },
  })
}
