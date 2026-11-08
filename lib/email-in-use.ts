// An email someone else already uses (#250). The database names the holder
// only when it is another Marketing Agent, whom whoever manages agents can
// see; anyone else, staff or the Super Admin, comes back as the email alone.

export type EmailTaken = {
  kind: "email-taken"
  email: string
  // The other agent holding the email, or null when the holder is someone
  // the caller can't see.
  agent: { name: string | null; code: string | null } | null
}

// The one sentence for a holder the caller can't see, on Staff and roles and
// on the Agents screen.
export function emailInUseMessage(email: string): string {
  return `${email} is already in use at Al-Rahmah. Use another email.`
}

// The Agents screen's sentence for an email that's taken.
export function emailTakenMessage(error: EmailTaken): string {
  if (!error.agent) return emailInUseMessage(error.email)
  if (!error.agent.name) return "This email belongs to another agent."
  return `This email belongs to agent ${error.agent.name}${error.agent.code ? ` (${error.agent.code})` : ""}.`
}

// Reads `email_taken`'s detail. `typed` is the email as entered, for a
// detail that carries none.
export function emailTakenFrom(details: string | null | undefined, typed: string | null): EmailTaken {
  let parsed: { email?: unknown; holder?: unknown; name?: unknown; code?: unknown } = {}
  try {
    parsed = (JSON.parse(details ?? "") as typeof parsed) ?? {}
  } catch {
    parsed = {}
  }
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null)
  const email = text(parsed.email) ?? (typed ?? "").trim().toLowerCase()
  const agent = parsed.holder === "agent" ? { name: text(parsed.name), code: text(parsed.code) } : null
  return { kind: "email-taken", email, agent }
}
