import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { supabaseEnv } from "./env"

// The secret-key client the SMS sends run with (#503): reserve_sms and
// record_sms accept only the secret key, and the Send SMS hook looks up the
// login's agent. The key is read from an unprefixed variable, so Next.js
// never ships it to a browser. Null when it isn't set: nothing is sent.
export function smsClient(): SupabaseClient | null {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) {
    console.error("SMS: SUPABASE_SECRET_KEY is not set, so no SMS can be sent. See .env.example.")
    return null
  }
  return createClient(supabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
