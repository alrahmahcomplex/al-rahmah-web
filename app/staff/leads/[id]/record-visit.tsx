"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { recordArrival } from "./actions"
import { Field, Refusal, Saved, useCorrection } from "./lead-editors"

// Record visit, for an Applied family who has come to campus. The Visit date
// starts at today. Once saved the lead is Visited and the screen refreshes
// without this offer, so the confirmation stays in its place.
export function RecordVisit({ leadId, today, canRecord }: { leadId: string; today: string; canRecord: boolean }) {
  const [recording, setRecording] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  if (recording) {
    return (
      <RecordVisitForm
        leadId={leadId}
        today={today}
        onDone={(message) => {
          setRecording(false)
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
        <Button
          type="button"
          onClick={() => {
            setSaved(null)
            setRecording(true)
          }}
        >
          Record visit
        </Button>
      </div>
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
