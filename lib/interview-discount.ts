import "server-only"

import { getInterviewDiscount } from "@/lib/services/referral"
import { publicFormClient } from "@/utils/supabase/public-form"

// The interview discount for a public page, read with the secret key, or
// null when Supabase is missing, down or slow (the read gives up after 2
// seconds). The page then names no figure rather than failing or guessing one.
export async function publicInterviewDiscount(): Promise<number | null> {
  try {
    const supabase = publicFormClient()
    if (!supabase) return null
    const read = await getInterviewDiscount(supabase)
    return read.ok ? read.data : null
  } catch (error) {
    console.error("Could not read the interview discount for a public page", error)
    return null
  }
}
