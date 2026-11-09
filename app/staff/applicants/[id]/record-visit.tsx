"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { recordArrival, visitDateToday } from "./actions"
import { Field, Refusal, Saved, useCorrection } from "./lead-editors"

// Record visit, in the lead's Next step card, for an Applied family who has
// come to campus. The Visit date starts at today in Tanzania, asked of the
// server as the form opens: a screen left open past midnight, or a device
// whose clock is wrong, still offers the day the database accepts. Once
// saved the lead is Visited and the screen refreshes without this offer, so
// the confirmation stays in its place.
//
// `offer` is "step" when Record visit is the Next step, and gets the step's
// orange button. It is "secondary" when the lead is still Applied but the
// step is something else, such as a follow-up that is due: the visit can
// still be recorded, from an outline button beside the step's own action.
//
// Opening the form moves focus to its Visit date, and Cancel hands focus
// back to the Record visit button that opened it (#254), so keyboard and
// screen-reader users keep their place.
export function RecordVisit({ leadId, offer }: { leadId: string; offer: "step" | "secondary" | null }) {
  // Today in Tanzania while the form is open, else null.
  const [recording, setRecording] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [unopened, setUnopened] = useState(false)
  const [opening, startOpening] = useTransition()
  // Set by Cancel, so the button takes focus again as it comes back.
  const refocus = useRef(false)

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
          // Only when a button comes back to take it.
          refocus.current = message === null && offer !== null
          setRecording(null)
          setSaved(message)
        }}
      />
    )
  }

  if (offer === null) return saved ? <div className="basis-full"><Saved message={saved} /></div> : null

  return (
    <>
      <Button
        type="button"
        variant={offer === "step" ? "orange" : "outline"}
        size="lg"
        className="h-10 px-4"
        onClick={open}
        disabled={opening}
        ref={(button) => {
          if (button && refocus.current) {
            refocus.current = false
            button.focus()
          }
        }}
      >
        {opening ? "Opening…" : "Record visit"}
      </Button>
      {unopened && (
        <Alert variant="destructive" role="alert" className="basis-full">
          <AlertDescription>Record visit could not open. Check your connection and try again.</AlertDescription>
        </Alert>
      )}
    </>
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
  const visitDateRef = useRef<HTMLInputElement>(null)
  useEffect(() => visitDateRef.current?.focus(), [])
  const { refusal, pending, save } = useCorrection(() => onDone("Visit recorded. The applicant is now Visited."))

  return (
    <form
      aria-label="Record visit"
      className="flex max-w-xl basis-full flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => recordArrival(leadId, visitDate))
      }}
    >
      <Refusal refusal={refusal} />
      <Field label="Visit date" hint="The day the family came to campus: today or earlier.">
        {({ id, describedBy }) => (
          <Input
            ref={visitDateRef}
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
