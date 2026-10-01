import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { supabaseEnv } from "./env"

// The secret-key client the public Admission form writes with. A parent has no
// session, and the Admission form start of create_lead accepts only the
// secret key, so the form's Server Action uses this after the rate limit and
// Turnstile have passed. The key is read from an unprefixed variable, so
// Next.js never ships it to a browser. Null when it isn't set: the form then
// answers "try again later" and the log says why.
export function publicFormClient(): SupabaseClient | null {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) {
    console.error("Admission form: SUPABASE_SECRET_KEY is not set, so no form can be saved. See .env.example.")
    return null
  }
  return createClient(supabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
