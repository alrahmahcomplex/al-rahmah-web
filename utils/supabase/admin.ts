import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { SendInvite } from "@/lib/services/staff-admin"

import { supabaseEnv } from "./env"

// The staff side's one use of the secret key: sending Supabase's invite email.
// (The public Admission form has its own, in public-form.ts.)
// Everything else, the staff record included, goes through the signed-in
// staff member's session so the database checks their permission. The key is
// read from an unprefixed variable so Next.js never ships it to a browser,
// and this module hands out only the send function, never the client.
export function inviteSender(): SendInvite {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) {
    // Reported as a failed send: the staff record stays, and Resend invite
    // works once the key is set.
    return async () => ({
      error: { message: "SUPABASE_SECRET_KEY must be set on the server to send staff invites. See .env.example." },
    })
  }

  const admin = createClient(supabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return async (email, redirectTo) => {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
  }
}
