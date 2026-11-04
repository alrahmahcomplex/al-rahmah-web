import "server-only"

import { getInterviewDiscount } from "@/lib/services/referral"
import { publicFormClient } from "@/utils/supabase/public-form"

// How long a public page waits for the interview discount before it renders
// without the figure.
const WAIT_MS = 2000

// The interview discount for a public page, read with the secret key, or
// null when Supabase is missing, down or slow. The page then names no figure
// rather than failing or guessing one.
export async function publicInterviewDiscount(): Promise<number | null> {
  try {
    const supabase = publicFormClient()
    if (!supabase) return null
    const read = await getInterviewDiscount(supabase, { signal: AbortSignal.timeout(WAIT_MS) })
    return read.ok ? read.data : null
  } catch (error) {
    console.error("Could not read the interview discount for a public page", error)
    return null
  }
}
