import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { AgentInviteSender, LoginEmailUpdater } from "@/lib/services/agent-invites"
import type { SendInvite } from "@/lib/services/staff-admin"

import { supabaseEnv } from "./env"

// The staff side's uses of the secret key: sending Supabase's invite email,
// and (for agents, #191) changing a joined agent's sign-in email.
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

const MISSING_KEY = "SUPABASE_SECRET_KEY must be set on the server to send invites. See .env.example."

function adminAuth() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) return null
  return createClient(supabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth.admin
}

// The Discount code invite (#191). `kind: agent` in the user metadata only
// picks the email template's agent wording; it grants nothing (ADR 5).
export function agentInviteSender(): AgentInviteSender {
  const admin = adminAuth()
  if (!admin) return async () => ({ error: { message: MISSING_KEY, code: "secret_key_missing" } })
  return async (email, redirectTo) => {
    const { error } = await admin.inviteUserByEmail(email, { redirectTo, data: { kind: "agent" } })
    return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
  }
}

// Changes a joined agent's sign-in email, marked confirmed, so Supabase
// sends no confirmation email.
export function loginEmailUpdater(): LoginEmailUpdater {
  const admin = adminAuth()
  if (!admin) return async () => ({ error: { message: MISSING_KEY } })
  return async (userId, email) => {
    const { error } = await admin.updateUserById(userId, { email, email_confirm: true })
    return { error: error ? { message: error.message } : null }
  }
}
