"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AccountState } from "@/lib/services/agent-invites"
import { cn } from "@/lib/utils"

import { saveMarketingAgentEmail, sendMarketingAgentInvite } from "./invite-actions"
import { accountBadge } from "./invite-outcome"

type Agent = { id: string; fullName: string; code: string }

// The agent's account-state badge, with the line under it: when the invite
// was sent, or why the latest attempt failed. Retired and switched off have
// their own badges beside the status, so they show nothing more here.
export function AccountStateBadge({ state, line }: { state: AccountState | null; line: string | null }) {
  if (!state || state === "retired" || state === "switched_off") return null
  const badge = accountBadge(state)
  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      <Badge
        variant="outline"
        className={cn(
          badge.attention && "border-amber-300 bg-amber-50 text-amber-900",
          state === "joined" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        )}
      >
        {badge.label}
      </Badge>
      {line && <p className="max-w-64 text-xs text-muted-foreground">{line}</p>}
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
  emailUnknown = false,
}: {
  agent: Agent
  email: string | null
  state: AccountState | null
  // Whether an invite to this email ever went out.
  everSent: boolean
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
      if (outcome.status === "sent") toast.success(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-2">
        {email && state && INVITABLE.includes(state) && (
          <Button size="sm" variant="outline" onClick={send} disabled={pending} aria-label={`${label} to ${agent.fullName}`}>
            {pending ? "Sending…" : label}
          </Button>
        )}
        {state === "joined" ? (
          <Button size="sm" variant="ghost" disabled aria-describedby={joinedNoteId}>
            Edit email
          </Button>
        ) : (
          <EditEmail agent={agent} email={email} />
        )}
      </div>
      {/* A joined agent's email is their sign-in, kept in Supabase Auth, and
          only they change it (owner decision 41). */}
      {state === "joined" && (
        <p id={joinedNoteId} className="max-w-56 text-xs text-muted-foreground">
          Only the agent can change this now.
        </p>
      )}
      {refusal && (
        <p role="alert" className="max-w-56 text-xs text-destructive">
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
      toast.success(outcome.message)
    })
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => changeOpen(true)} aria-label={`${verb} for ${agent.fullName}`}>
        {verb}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {verb} for {agent.fullName}
              </DialogTitle>
              <DialogDescription id={hintId}>
                Phone them to check the address is theirs. Once it is saved, send the invite from their row. A link already
                sent to an earlier address stops working.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>Email</Label>
              <Input
                id={fieldId}
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
              <Alert variant="destructive">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save email"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
