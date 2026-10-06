"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { Field, Saved } from "./lead-editors"
import { lookUpReferralCode, saveLeadReferralCode } from "./referral-actions"
import { referralLookupNote, type ReferralLookup, type ReferralOutcome } from "./referral-outcome"

const LOST_REQUEST: ReferralOutcome = {
  status: "refused",
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// How long typing pauses before the code is looked up.
const LOOKUP_DELAY_MS = 300

// Edit and Clear on the Referral code panel. Edit opens an input that names
// the agent as the code is typed; Save takes only a code an agent holds.
// Clear asks first, since it can raise the interview fee.
export function ReferralEditor({
  leadId,
  current,
  discountApplied,
}: {
  leadId: string
  current: { code: string; agentName: string | null } | null
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
    <div className="flex flex-col gap-3">
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSaved(null)
              setRefusal(null)
              setEditing(true)
            }}
            disabled={pending}
          >
            {current ? "Edit" : "Add a code"}
          </Button>
          {current && (
            <Button type="button" variant="outline" onClick={() => setConfirmClear(true)} disabled={pending}>
              {pending ? "Clearing…" : "Clear"}
            </Button>
          )}
        </div>
      )}
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
      <Saved message={saved} />

      {current && (
        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear the referral code?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-mono font-semibold text-foreground">{current.code}</span>
                {current.agentName ? ` (${current.agentName})` : ""} will no longer be on this lead
                {discountApplied ? ", and the interview fee loses its discount." : "."} The lead&apos;s history keeps
                the change.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmClear(false)
                  send(null, () => {})
                }}
              >
                Clear code
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
  const found = lookup.status === "found" ? lookup.agent : null
  const unchanged = found !== null && found.code === current

  return (
    <form
      className="flex flex-col gap-3"
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
              aria-describedby={`${id}-agent`}
              aria-invalid={lookup.status === "none"}
              className="max-w-48 font-mono uppercase"
            />
            {/* Names the agent as the code is typed. */}
            <p
              id={`${id}-agent`}
              role="status"
              className={cn(
                "text-sm",
                lookup.status === "found" ? "text-slate-900" : lookup.status === "none" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {unchanged ? `${referralLookupNote(lookup)} (the lead's current code)` : referralLookupNote(lookup)}
            </p>
          </>
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !found || unchanged}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
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
