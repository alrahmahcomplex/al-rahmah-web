"use client"

import { useId, useState, useTransition } from "react"

import { Button, Card, Field, KeyValueList, Note, Sheet, Tag } from "@/components/kit"
import type { QueueClaim, QueueEntry } from "@/lib/services/agent-email-claims"

import { confirmAgentEmailClaim, rejectAgentEmailClaim } from "./claim-actions"
import type { ClaimOutcome } from "./claim-outcome"
import { toast } from "./form-parts"
import "./agents.css"

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
    <ol aria-label="Awaiting email confirmation" className="ag-claims">
      {entries.map((entry) => (
        <li key={entry.agentId}>
          <ClaimCard entry={entry} canApprove={canApprove} />
        </li>
      ))}
    </ol>
  )
}

function ClaimCard({ entry, canApprove }: { entry: QueueEntry; canApprove: boolean }) {
  const others = entry.claims.length - 1
  return (
    <Card
      title={
        <>
          {entry.fullName} <span className="ag-mono ag-quiet ag-small">{entry.code}</span>
        </>
      }
      caption={
        <span className="ag-row">
          {entry.status === "Pending" && <Tag tone="wait">Pending</Tag>}
          <span>
            Claimed <time dateTime={entry.claimedAt}>{WHEN.format(new Date(entry.claimedAt))}</time>
          </span>
        </span>
      }
    >
      <div className="ag-card-body">
        <Note tone="wait">
          Phone {entry.fullName} on{" "}
          <a href={`tel:${entry.phone}`} className="ag-link">
            {displayPhone(entry.phone)}
          </a>{" "}
          to check this email is theirs.
        </Note>
        {others > 0 && (
          <p className="ag-p ag-strong">
            {others} other {others === 1 ? "attempt" : "attempts"}: confirming one rejects the rest.
          </p>
        )}
        <ul className="ag-claims">
          {entry.claims.map((claim) => (
            <li key={claim.id}>
              <ClaimRow entry={entry} claim={claim} canApprove={canApprove} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
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
      if (outcome.status === "done") toast(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="ag-claim-attempt">
      <KeyValueList
        items={[
          { key: "Typed name", value: claim.fullName },
          { key: "Email", value: claim.email },
          { key: "Claimed", value: <time dateTime={claim.claimedAt}>{WHEN.format(new Date(claim.claimedAt))}</time> },
        ]}
      />
      {canApprove && (
        <div className="ag-cell">
          <div className="ag-row">
            <Button
              size="small"
              variant="ghost"
              disabled={pending}
              aria-label={`Confirm ${claim.email} for ${entry.fullName}`}
              onClick={() => run(() => confirmAgentEmailClaim(claim.id, entry.fullName, null))}
            >
              Confirm
            </Button>
            <SaveAndSend entry={entry} claim={claim} disabled={pending} />
            <Button
              size="small"
              variant="ghost"
              disabled={pending}
              aria-label={`Reject ${claim.email} for ${entry.fullName}`}
              onClick={() => run(() => rejectAgentEmailClaim(claim.id))}
            >
              Reject
            </Button>
          </div>
          {refusal && (
            <p role="alert" className="ag-error">
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
      toast(outcome.message)
    })
  }

  return (
    <>
      <Button size="small" variant="ghost" disabled={disabled} onClick={() => changeOpen(true)} aria-label={`Save and send invite for ${entry.fullName}`}>
        Save and send invite
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Save and send invite for ${entry.fullName}`}
        hint={`Correct the email as ${entry.fullName} gave it on the phone. Saving confirms this claim, rejects any other attempts, and sends the invite.`}
        hintId={hintId}
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={`${fieldId}-form`} size="wide" disabled={pending}>
              {pending ? "Saving…" : "Save and send invite"}
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
