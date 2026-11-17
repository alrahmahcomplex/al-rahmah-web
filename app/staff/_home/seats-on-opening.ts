import type { SupabaseClient } from "@supabase/supabase-js"

import { getSeatsByClass } from "@/lib/services/dashboard"

import { defaultSeatsYear } from "../seats/format"

/**
 * The seats in the year the Seats screen opens on, so what Home says about a
 * full class matches the page its link opens.
 */
export async function seatsOnOpening(supabase: SupabaseClient, today: string) {
  const latest = await getSeatsByClass(supabase)
  if (!latest.ok) return latest
  const opening = defaultSeatsYear(latest.data.years, today)
  return opening === null || opening === latest.data.year ? latest : getSeatsByClass(supabase, opening)
}
