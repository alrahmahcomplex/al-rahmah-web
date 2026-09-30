"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { recordArrival, visitDateToday } from "./actions"
import { Field, Refusal, Saved, useCorrection } from "./lead-editors"

// Record visit, for an Applied family who has come to campus. The Visit date
// starts at today in Tanzania, asked of the server as the form opens: a screen
// left open past midnight, or a device whose clock is wrong, still offers the
// day the database accepts. Once saved the lead is Visited and the screen
// refreshes without this offer, so the confirmation stays in its place.
export function RecordVisit({ leadId, canRecord }: { leadId: string; canRecord: boolean }) {
  // Today in Tanzania while the form is open, else null.
  const [recording, setRecording] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [unopened, setUnopened] = useState(false)
  const [opening, startOpening] = useTransition()

  function open() {
    setSaved(null)
    setUnopened(false)
    startOpening(async () => {
      try {
        setRecording(await visitDateToday())
      } catch {
        setUnopened(true)
      }
    })
  }

  if (recording) {
    return (
      <RecordVisitForm
        leadId={leadId}
        today={recording}
        onDone={(message) => {
          setRecording(null)
          setSaved(message)
        }}
      />
    )
  }

  if (!canRecord) return saved ? <Saved message={saved} /> : null

  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm text-slate-900">
        This family applied through the Admission form and hasn&apos;t visited yet. When they arrive, record the visit.
      </p>
      <div>
        <Button type="button" onClick={open} disabled={opening}>
          {opening ? "Opening…" : "Record visit"}
        </Button>
      </div>
      {unopened && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Record visit could not open. Check your connection and try again.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function RecordVisitForm({
  leadId,
  today,
  onDone,
}: {
  leadId: string
  today: string
  onDone: (saved: string | null) => void
}) {
  const [visitDate, setVisitDate] = useState(today)
  const { refusal, pending, save } = useCorrection(() => onDone("Visit recorded. The lead is now Visited."))

  return (
    <form
      aria-label="Record visit"
      className="flex max-w-xl flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => recordArrival(leadId, visitDate))
      }}
    >
      <Refusal refusal={refusal} />
      <Field label="Visit date" hint="The day the family came to campus: today or earlier.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            max={today}
            value={visitDate}
            onChange={(event) => setVisitDate(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.status === "refused" && refusal.field === "visit_date" ? true : undefined}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record visit"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onDone(null)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
