import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The Discount code page's sign-up and claim (#193), one database call:
// sign_up_marketing_agent settles every combination with its ordered
// decision table (supabase/migrations/20261127120700_agent_email_claims.sql)
// and never sends email or overwrites a stored email. Takes the secret-key
// client: only the server calls it, after the rate limit and Turnstile.

export type SignUpField = "full_name" | "phone" | "whatsapp" | "email" | "code"

export type SignUp = {
  fullName: string
  phone: string
  whatsapp: string | null
  email: string
  // "Already have a Discount code?" ticked: claim the code's record.
  hasCode: boolean
  // Optional unticked; a typed code is adopted only if no one has used it.
  code: string | null
}

// What the page shows, one per row of the decision table.
export type SignUpOutcome =
  // A new Pending agent, or a retry of one: the code and the email given.
  | { kind: "registered"; code: string; email: string }
  // A claim waits for the school, or a retry of one: the claimed code.
  | { kind: "claimed"; code: string }
  // The phone has a code already: tick the box and type it.
  | { kind: "code_needed" }
  // Box ticked: the code's record has another phone.
  | { kind: "phone_mismatch" }
  // Box ticked: no current record holds the code (or it is switched off).
  | { kind: "no_match" }
  // A claim is already waiting, or the record's email awaits its invite.
  | { kind: "claim_waiting" }
  // An invite went out: check spam, or ask for a new link.
  | { kind: "invited" }
  // The agent has joined: sign in.
  | { kind: "joined" }
  // Staff, another agent or another login uses the email.
  | { kind: "email_unusable" }
  | { kind: "access_off" }

export type SignUpError = { kind: "invalid"; field: SignUpField } | { kind: "unavailable" }

const FIELDS = new Set<string>(["full_name", "phone", "whatsapp", "email", "code"])

function refusedField(details: string | null | undefined): SignUpField | null {
  try {
    const field = JSON.parse(details ?? "")?.field
    return typeof field === "string" && FIELDS.has(field) ? (field as SignUpField) : null
  } catch {
    return null
  }
}

type Row = { outcome?: string; code?: string; email?: string }

function outcomeOf(row: Row | null): SignUpOutcome | null {
  switch (row?.outcome) {
    case "registered":
      return row.code && row.email ? { kind: "registered", code: row.code, email: row.email } : null
    case "claimed":
      return row.code ? { kind: "claimed", code: row.code } : null
    case "code_needed":
    case "phone_mismatch":
    case "no_match":
    case "claim_waiting":
    case "invited":
    case "joined":
    case "email_unusable":
    case "access_off":
      return { kind: row.outcome }
    default:
      return null
  }
}

export async function signUpAgent(supabase: SupabaseClient, signUp: SignUp): Promise<Result<SignUpOutcome, SignUpError>> {
  const { data, error } = await supabase.rpc("sign_up_marketing_agent", {
    full_name: signUp.fullName,
    phone: signUp.phone,
    whatsapp: signUp.whatsapp,
    email: signUp.email,
    has_code: signUp.hasCode,
    code: signUp.code,
  })
  if (error) {
    if (error.message === "invalid") {
      const field = refusedField(error.details)
      if (field) return { ok: false, error: { kind: "invalid", field } }
    }
    console.error("Could not sign up a Discount code holder", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const outcome = outcomeOf(data as Row | null)
  if (!outcome) {
    console.error("Unexpected sign-up answer", data)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return { ok: true, data: outcome }
}
