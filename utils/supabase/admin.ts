import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { AgentInviteSender, AgentLogins } from "@/lib/services/agent-invites"
import type { SendInvite } from "@/lib/services/staff-admin"

import { supabaseEnv } from "./env"

// The staff side's uses of the secret key: sending Supabase's invite email,
// and (for agents, #191) changing a joined agent's sign-in email and keeping
// their stored email in line with it.
// (The public Admission form has its own, in public-form.ts.)
// Everything else, the staff record included, goes through the signed-in
// staff member's session so the database checks their permission. The key is
// read from an unprefixed variable so Next.js never ships it to a browser,
// and this module hands out only those functions, never the client.
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

function secretClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) return null
  return createClient(supabaseEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function adminAuth() {
  return secretClient()?.auth.admin ?? null
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

// A joined agent's sign-in email: changing it, marked confirmed so Supabase
// sends no confirmation email and marked with the change or put-back it
// carries out (app_metadata, which agents can't write), and reconciling the
// stored email to it (reconcile_agent_emails and confirm_agent_email_repair,
// which only the secret key may call).
export function agentLogins(): AgentLogins {
  const client = secretClient()
  if (!client) {
    return {
      update: async () => ({ error: { message: MISSING_KEY } }),
      reconcile: async () => ({ data: null, error: { message: MISSING_KEY } }),
      confirmRepair: async () => ({ data: null, error: { message: MISSING_KEY } }),
    }
  }
  return {
    update: async (userId, email, writeId) => {
      const { error } = await client.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
        app_metadata: { agent_email_write: writeId },
      })
      return { error: error ? { message: error.message } : null }
    },
    reconcile: async (agentId) => {
      const { data, error } = await client.rpc("reconcile_agent_emails", { for_agent: agentId })
      return { data, error: error ? { message: error.message, code: error.code } : null }
    },
    confirmRepair: async (repairId) => {
      const { data, error } = await client.rpc("confirm_agent_email_repair", { repair_id: repairId })
      return { data, error: error ? { message: error.message, code: error.code } : null }
    },
  }
}
