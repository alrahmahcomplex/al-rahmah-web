"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { QueueClaim, QueueEntry } from "@/lib/services/agent-email-claims"

import { confirmAgentEmailClaim, rejectAgentEmailClaim } from "./claim-actions"
import type { ClaimOutcome } from "./claim-outcome"

// The "Awaiting email confirmation" queue (#193): each agent with a claim
// waiting, oldest first, the stored record beside each typed name and email.
// The Manager phones first, then confirms one claim (which rejects the
// others), rejects one, or saves a corrected email and sends the invite.

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// A phone stored as +255700000401 shown as +255 700 000 401.
function displayPhone(phone: string) {
  const match = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `+255 ${match[1]} ${match[2]} ${match[3]}` : phone
}

const LOST: ClaimOutcome = { status: "refused", message: "The request was lost. Reload the page to see whether it went through." }

export function ClaimQueue({ entries, canApprove }: { entries: QueueEntry[]; canApprove: boolean }) {
  return (
    <ol aria-label="Awaiting email confirmation" className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.agentId}>
          <ClaimCard entry={entry} canApprove={canApprove} />
        </li>
      ))}
    </ol>
  )
}

function ClaimCard({ entry, canApprove }: { entry: QueueEntry; canApprove: boolean }) {
  const headingId = useId()
  const others = entry.claims.length - 1
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="staff-section-heading">
          {entry.fullName} <span className="font-mono text-sm text-muted-foreground">{entry.code}</span>
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {entry.status === "Pending" && <Badge variant="outline">Pending</Badge>}
          <span>
            Claimed <time dateTime={entry.claimedAt}>{WHEN.format(new Date(entry.claimedAt))}</time>
          </span>
        </div>
      </div>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Phone {entry.fullName} on{" "}
        <a href={`tel:${entry.phone}`} className="font-medium underline underline-offset-4">
          {displayPhone(entry.phone)}
        </a>{" "}
        to check this email is theirs.
      </p>
      {others > 0 && (
        <p className="text-sm font-medium text-amber-900">
          {others} other {others === 1 ? "attempt" : "attempts"}: confirming one rejects the rest.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {entry.claims.map((claim) => (
          <li key={claim.id}>
            <ClaimRow entry={entry} claim={claim} canApprove={canApprove} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ClaimRow({ entry, claim, canApprove }: { entry: QueueEntry; claim: QueueClaim; canApprove: boolean }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(work: () => Promise<ClaimOutcome>) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: ClaimOutcome
      try {
        outcome = await work()
      } catch {
        outcome = LOST
      }
      if (outcome.status === "done") toast.success(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">Typed name</dt>
        <dd>{claim.fullName}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="wrap-anywhere">{claim.email}</dd>
        <dt className="text-muted-foreground">Claimed</dt>
        <dd>
          <time dateTime={claim.claimedAt}>{WHEN.format(new Date(claim.claimedAt))}</time>
        </dd>
      </dl>
      {canApprove && (
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              aria-label={`Confirm ${claim.email} for ${entry.fullName}`}
              onClick={() => run(() => confirmAgentEmailClaim(claim.id, entry.fullName, null))}
            >
              Confirm
            </Button>
            <SaveAndSend entry={entry} claim={claim} disabled={pending} />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              aria-label={`Reject ${claim.email} for ${entry.fullName}`}
              onClick={() => run(() => rejectAgentEmailClaim(claim.id))}
            >
              Reject
            </Button>
          </div>
          {refusal && (
            <p role="alert" className="max-w-64 text-xs text-destructive">
              {refusal}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SaveAndSend({ entry, claim, disabled }: { entry: QueueEntry; claim: QueueClaim; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(claim.email)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldId = useId()
  const hintId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    setRefusal(null)
    if (next) setValue(claim.email)
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRefusal(null)
    startTransition(async () => {
      let outcome: ClaimOutcome
      try {
        outcome = await confirmAgentEmailClaim(claim.id, entry.fullName, value)
      } catch {
        outcome = LOST
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      toast.success(outcome.message)
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => changeOpen(true)} aria-label={`Save and send invite for ${entry.fullName}`}>
        Save and send invite
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Save and send invite for {entry.fullName}</DialogTitle>
              <DialogDescription id={hintId}>
                Correct the email as {entry.fullName} gave it on the phone. Saving confirms this claim, rejects any other
                attempts, and sends the invite.
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
                {pending ? "Saving…" : "Save and send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
