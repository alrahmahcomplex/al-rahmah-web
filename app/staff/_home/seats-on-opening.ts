import type { SupabaseClient } from "@supabase/supabase-js"

import { getSeatsByClass } from "@/lib/services/dashboard"

/**
 * The seats in the year the Seats screen opens on, so what Home says about a
 * full class matches the page its link opens.
 */
export function seatsOnOpening(supabase: SupabaseClient, today: string) {
  return getSeatsByClass(supabase, null, today)
}
