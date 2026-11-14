"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import { STAFF_REMINDER } from "@/lib/referral-notice"

import { Field, Input, Saved } from "./lead-editors"
import { lookUpReferralCode, saveLeadReferralCode } from "./referral-actions"
import { referralLookupNote, usableCode, type ReferralLookup, type ReferralOutcome } from "./referral-outcome"

const LOST_REQUEST: ReferralOutcome = {
  status: "refused",
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// How long typing pauses before the code is looked up.
const LOOKUP_DELAY_MS = 300

// Edit and Clear on the Referral code panel. Edit opens an input that names
// the agent or Promo code as the code is typed; Save takes only a code a
// current agent or a Promo code holds.
// Clear asks first, since it can raise the interview fee.
export function ReferralEditor({
  leadId,
  current,
  discountApplied,
}: {
  leadId: string
  current: { code: string; holderName: string | null } | null
  discountApplied: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(code: string | null, onSaved: () => void) {
    setRefusal(null)
    setSaved(null)
    startTransition(async () => {
      let outcome: ReferralOutcome
      try {
        outcome = await saveLeadReferralCode(leadId, code)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") {
        onSaved()
        setSaved(outcome.message)
      } else setRefusal(outcome.message)
    })
  }

  return (
    <div className="lr-card">
      {editing ? (
        <CodeForm
          current={current?.code ?? null}
          pending={pending}
          onSave={(code) => send(code, () => setEditing(false))}
          onCancel={() => {
            setEditing(false)
            setRefusal(null)
          }}
        />
      ) : (
        <div className="lr-acts">
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setSaved(null)
              setRefusal(null)
              setEditing(true)
            }}
            aria-disabled={pending || undefined}
          >
            {current ? "Edit" : "Add a code"}
          </Button>
          {current && (
            <Button variant="ghost" size="small" onClick={() => setConfirmClear(true)} pending={pending}>
              {pending ? "Clearing…" : "Clear"}
            </Button>
          )}
        </div>
      )}
      {refusal && (
        <Note tone="bad" role="alert">{refusal}</Note>
      )}
      <Saved message={saved} />

      {current && (
        <Sheet
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title="Clear the referral code?"
          hint={
            <>
              <span className="lr-num font-semibold">{current.code}</span>
              {current.holderName ? ` (${current.holderName})` : ""} will no longer be on this application
              {discountApplied ? ", and the interview fee loses its discount." : "."} The application&apos;s history keeps
              the change.
            </>
          }
          closeLabel="Close"
          foot={
            <>
              <Button
                size="wide"
                onClick={() => {
                  setConfirmClear(false)
                  send(null, () => {})
                }}
              >
                Clear code
              </Button>
              <Button variant="ghost" size="wide" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </>
          }
        >
          {null}
        </Sheet>
      )}
    </div>
  )
}

function CodeForm({
  current,
  pending,
  onSave,
  onCancel,
}: {
  current: string | null
  pending: boolean
  onSave: (code: string) => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState(current ?? "")
  const lookup = useCodeLookup(typed)
  const found = usableCode(lookup)
  const unchanged = found !== null && found.code === current

  return (
    <form
      className="lr-form lr-inline"
      onSubmit={(event) => {
        event.preventDefault()
        if (found && !unchanged) onSave(found.code)
      }}
    >
      <Field label="Referral code">
        {({ id }) => (
          <>
            <Input
              id={id}
              name="referral_code"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              aria-describedby={typed.trim() ? `${id}-agent ${id}-reminder` : `${id}-agent`}
              aria-invalid={lookup.status === "none" || (lookup.status === "found" && found === null)}
              className="max-w-48 uppercase"
            />
            {/* Names the agent as the code is typed. */}
            <p
              id={`${id}-agent`}
              role="status"
              className={found ? "lr-text" : lookup.status === "none" || lookup.status === "found" ? "lr-error" : "lr-quiet"}
            >
              {unchanged ? `${referralLookupNote(lookup)} (the application's current code)` : referralLookupNote(lookup)}
            </p>
            {/* A code staff save records that the family was told (#182). */}
            {typed.trim() && (
              <p id={`${id}-reminder`} data-notice-version="staff_reminder" className="lr-text">
                {STAFF_REMINDER}
              </p>
            )}
          </>
        )}
      </Field>
      <div className="lr-acts">
        <Button type="submit" size="small" pending={pending} aria-disabled={!found || unchanged || undefined}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" size="small" onClick={onCancel} aria-disabled={pending || undefined}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Looks the typed code up once typing pauses. A slower answer to an earlier
// code never replaces the answer to the latest one. New Student's Referral
// code field uses it too.
export function useCodeLookup(typed: string): ReferralLookup {
  const [lookup, setLookup] = useState<{ typed: string; result: ReferralLookup } | null>(null)
  const latest = useRef(typed)

  useEffect(() => {
    latest.current = typed
    if (typed.trim() === "") return
    const timer = setTimeout(async () => {
      let result: ReferralLookup
      try {
        result = await lookUpReferralCode(typed)
      } catch {
        result = { status: "unavailable" }
      }
      if (latest.current === typed) setLookup({ typed, result })
    }, LOOKUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed])

  if (typed.trim() === "") return { status: "empty" }
  if (!lookup || lookup.typed !== typed) return { status: "checking" }
  return lookup.result
}
