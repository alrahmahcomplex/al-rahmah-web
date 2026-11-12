"use client"

import { useId, useState, useTransition } from "react"

import { Button, Field, Note, Sheet, Tag, TextLink } from "@/components/kit"
import type { AccountState } from "@/lib/services/agent-invites"

import { saveMarketingAgentEmail, sendMarketingAgentInvite } from "./invite-actions"
import { accountBadge } from "./invite-outcome"
import { toast } from "./form-parts"
import "./agents.css"

type Agent = { id: string; fullName: string; code: string }

// The agent's account-state badge, with the line under it: when the invite
// was sent, or why the latest attempt failed. Retired and switched off have
// their own badges beside the status, so they show nothing more here.
export function AccountStateBadge({ state, line }: { state: AccountState | null; line: string | null }) {
  if (!state || state === "retired" || state === "switched_off") return null
  const badge = accountBadge(state)
  return (
    <div className="ag-cell">
      <Tag tone={badge.attention ? "wait" : state === "joined" ? "ok" : "line"}>{badge.label}</Tag>
      {line && <small>{line}</small>}
    </div>
  )
}

const INVITABLE: readonly AccountState[] = ["invite_not_sent", "invite_expired", "invited"]

// Send invite (or Resend) and Add or Edit email, for the Manager.
export function AgentInviteActions({
  agent,
  email,
  state,
  everSent,
  joined = false,
  emailUnknown = false,
}: {
  agent: Agent
  email: string | null
  state: AccountState | null
  // Whether an invite to this email ever went out.
  everSent: boolean
  // They have joined (even if switched off since): only they change the email.
  joined?: boolean
  // The emails couldn't be read, so there is nothing to send to or edit.
  emailUnknown?: boolean
}) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const joinedNoteId = useId()
  const label = everSent ? "Resend invite" : "Send invite"
  if (emailUnknown) return null

  function send() {
    if (!email) return
    setRefusal(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await sendMarketingAgentInvite(agent.id, email)
      } catch {
        outcome = { status: "refused" as const, message: "Invite not sent: the request was lost. Reload the page to see whether it went." }
      }
      if (outcome.status === "sent") toast(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="ag-cell">
      <div className="ag-row">
        {email && state && INVITABLE.includes(state) && (
          <Button size="small" variant="ghost" onClick={send} disabled={pending} aria-label={`${label} to ${agent.fullName}`}>
            {pending ? "Sending…" : label}
          </Button>
        )}
        {joined ? (
          <TextLink disabled aria-describedby={joinedNoteId}>
            Edit email
          </TextLink>
        ) : (
          <EditEmail agent={agent} email={email} />
        )}
      </div>
      {/* A joined agent's email is their sign-in, kept in Supabase Auth, and
          only they change it (owner decision 41). */}
      {joined && (
        <p id={joinedNoteId} className="ag-hint">
          Only the agent can change this now.
        </p>
      )}
      {refusal && (
        <p role="alert" className="ag-error">
          {refusal}
        </p>
      )}
    </div>
  )
}

function EditEmail({ agent, email }: { agent: Agent; email: string | null }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(email ?? "")
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldId = useId()
  const hintId = useId()
  const verb = email ? "Edit email" : "Add email"

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    setRefusal(null)
    if (next) setValue(email ?? "")
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRefusal(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await saveMarketingAgentEmail(agent.id, value)
      } catch {
        outcome = { status: "refused" as const, message: "The email could not be confirmed as saved. Reload the page to check it." }
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      toast(outcome.message)
    })
  }

  return (
    <>
      <TextLink onClick={() => changeOpen(true)} aria-label={`${verb} for ${agent.fullName}`}>
        {verb}
      </TextLink>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`${verb} for ${agent.fullName}`}
        hint="Phone them to check the address is theirs. Once it is saved, send the invite from their row. A link already sent to an earlier address stops working."
        hintId={hintId}
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={`${fieldId}-form`} size="wide" disabled={pending}>
              {pending ? "Saving…" : "Save email"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={`${fieldId}-form`} onSubmit={save} className="ag-stack">
          <div className="ag-field">
            <label htmlFor={fieldId} className="ag-label">
              Email
            </label>
            <Field
              id={fieldId}
              size="compact"
              alignStart
              type="email"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby={hintId}
            />
          </div>
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}
