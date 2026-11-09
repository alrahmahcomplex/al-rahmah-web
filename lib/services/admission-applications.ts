import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// How many children families have sent through the Admission form this
// calendar year, Tanzania time: the number behind the form's "we already
// have N applications". One aggregate from admission_form_application_count(),
// which only the secret key may call.

// How long the read waits before giving up.
const COUNT_WAIT_MS = 2000

// The count, or unavailable when Supabase refuses, fails or takes longer than
// 2 seconds. The page can do without the number, so this never throws.
export async function getAdmissionApplicationCount(
  supabase: SupabaseClient,
): Promise<Result<number, "unavailable">> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), COUNT_WAIT_MS)
  try {
    const { data, error } = await supabase.rpc("admission_form_application_count").abortSignal(timeout.signal)
    if (error || typeof data !== "number") {
      console.error("Could not read the Admission form application count", error)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data }
  } catch (error) {
    console.error("Could not read the Admission form application count", error)
    return { ok: false, error: "unavailable" }
  } finally {
    clearTimeout(timer)
  }
}
