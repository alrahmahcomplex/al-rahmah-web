"use client"

import { useId, useState, useTransition } from "react"

import { tanzaniaToday } from "@/lib/school-calendar"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { CONTACT_METHODS, type ContactStaff } from "@/lib/services/follow-ups"
import { DECLINE_EXPLANATION_MAX, type DeclinedReason } from "@/lib/services/lead-closure"

import { DECLINE_CONSEQUENCE } from "./decline-lead"
import { changeLeadFollowUpDate, recordLeadFollowUp, scheduleLeadFollowUp } from "./follow-up-actions"
import { addDays, type FollowUpOutcome } from "./follow-up-outcome"
import { tanzaniaNowLocal } from "./follow-up-record-format"
import { Field, Saved } from "./lead-editors"

const LOST_REQUEST: FollowUpOutcome = {
  status: "refused",
  field: null,
  message: "The follow-up could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// Schedule follow-up, or Change date once a follow-up is open. Rendered for
// every open lead the staff member may plan for, so the confirmation outlasts
// the refresh that swaps one action for the other.
export function FollowUpActions({
  leadId,
  today,
  current,
  enrolled,
  declineReasons = null,
  signedIn,
  contactStaff,
}: {
  leadId: string
  // Today in Tanzania, as the server rendered the panel.
  today: string
  current: { id: string; dueOn: string } | null
  // An Enrolled lead may record a contact with no next date.
  enrolled: boolean
  // The Declined reasons this staff member may pick, offered when the family
  // will not proceed; null leaves that outcome off.
  declineReasons?: readonly DeclinedReason[] | null
  // The signed-in staff member, who made the contact unless they say
  // otherwise.
  signedIn: ContactStaff
  // Who may be named as having made a contact; null when the list could not
  // be loaded, leaving only the signed-in staff member.
  contactStaff: ContactStaff[] | null
}) {
  const [dialog, setDialog] = useState<"schedule" | "change" | "record" | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Today as of the dialog opening, so a page left open past midnight in
  // Tanzania offers the same dates the database accepts.
  const [openedOn, setOpenedOn] = useState(today)

  function openDialog(which: "schedule" | "change" | "record") {
    setSaved(null)
    setOpenedOn(laterOf(today, tanzaniaToday()))
    setDialog(which)
  }

  function done(message: string) {
    setDialog(null)
    setSaved(message)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {current ? (
          <>
            <Button type="button" onClick={() => openDialog("record")}>
              Record follow-up
            </Button>
            <Button type="button" variant="outline" onClick={() => openDialog("change")}>
              Change date
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={() => openDialog("schedule")}>
              Schedule follow-up
            </Button>
            {/* A contact nobody planned, such as the family phoning in. */}
            <Button type="button" variant="outline" onClick={() => openDialog("record")}>
              Record follow-up
            </Button>
          </>
        )}
      </div>
      <Saved message={saved} />
      <Dialog open={dialog === "schedule"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {dialog === "schedule" && <ScheduleForm leadId={leadId} today={openedOn} onDone={done} />}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "change"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {dialog === "change" && current && <ChangeDateForm leadId={leadId} today={openedOn} current={current} onDone={done} />}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "record"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          {dialog === "record" && (
            <RecordForm
              leadId={leadId}
              today={openedOn}
              followUpId={current?.id ?? null}
              enrolled={enrolled}
              declineReasons={declineReasons}
              signedIn={signedIn}
              contactStaff={contactStaff}
              onDone={done}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// The later of two YYYY-MM-DD dates: a browser clock running behind never
// moves the dates offered earlier than the server's today.
function laterOf(a: string, b: string) {
  return a > b ? a : b
}

function useSave(onDone: (message: string) => void) {
  const [refusal, setRefusal] = useState<Extract<FollowUpOutcome, { status: "refused" }> | null>(null)
  const [pending, startTransition] = useTransition()

  function save(send: () => Promise<FollowUpOutcome>) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: FollowUpOutcome
      try {
        outcome = await send()
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onDone(outcome.message)
      else setRefusal(outcome)
    })
  }

  return { refusal, pending, save, refuse: setRefusal }
}

function Refused({ refusal }: { refusal: { message: string } | null }) {
  if (!refusal) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{refusal.message}</AlertDescription>
    </Alert>
  )
}

const DATE_HINT = "Today or any day up to one year ahead."

function ScheduleForm({ leadId, today, onDone }: { leadId: string; today: string; onDone: (message: string) => void }) {
  const [dueOn, setDueOn] = useState(addDays(today, 1))
  const [note, setNote] = useState("")
  const { refusal, pending, save } = useSave(onDone)

  return (
    <form
      aria-label="Schedule follow-up"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => scheduleLeadFollowUp(leadId, dueOn, note))
      }}
    >
      <DialogHeader>
        <DialogTitle>Schedule follow-up</DialogTitle>
        <DialogDescription>Plan when the school will next contact this family.</DialogDescription>
      </DialogHeader>
      <Refused refusal={refusal} />
      <Field label="Follow-up date" hint={DATE_HINT}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            min={today}
            max={addDays(today, 365)}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "due_on" ? true : undefined}
          />
        )}
      </Field>
      <Field label="Note (optional)" hint="What the contact is for. Up to 500 characters.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "note" ? true : undefined}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Scheduling…" : "Schedule follow-up"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ChangeDateForm({
  leadId,
  today,
  current,
  onDone,
}: {
  leadId: string
  today: string
  current: { id: string; dueOn: string }
  onDone: (message: string) => void
}) {
  // The form starts from tomorrow: a change has to move the date, and an
  // overdue date can't be kept anyway.
  const [dueOn, setDueOn] = useState(addDays(today, 1) === current.dueOn ? addDays(today, 2) : addDays(today, 1))
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const { refusal, pending, save, refuse } = useSave(onDone)

  return (
    <form
      aria-label="Change date"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dueOn === current.dueOn) {
          refuse({ status: "refused", field: "due_on", message: "Pick a date different from the current one." })
          return
        }
        save(() => changeLeadFollowUpDate(leadId, current.id, dueOn, reason, note))
      }}
    >
      <DialogHeader>
        <DialogTitle>Change date</DialogTitle>
        <DialogDescription>The earlier date and your reason stay in the lead&apos;s history.</DialogDescription>
      </DialogHeader>
      <Refused refusal={refusal} />
      <Field label="New date" hint={DATE_HINT}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            min={today}
            max={addDays(today, 365)}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "due_on" ? true : undefined}
          />
        )}
      </Field>
      <Field label="Reason" hint="Why the date is moving, such as the parent is travelling. 3 to 500 characters.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "reason" ? true : undefined}
          />
        )}
      </Field>
      <Field label="New note (optional)" hint="Leave empty to keep the current note.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "note" ? true : undefined}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change date"}
        </Button>
      </DialogFooter>
    </form>
  )
}

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const DECLINE_OUTCOME = "The family will not proceed: decline the lead"

// Record follow-up: what happened on a call, message or visit, then the next
// follow-up date, or, for staff who may decline leads, a Declined reason when
// the family will not proceed. followUpId is the open follow-up the panel
// showed, or null for a contact nobody planned; if that has changed by the
// time this is saved, the database refuses and the form offers a reload.
function RecordForm({
  leadId,
  today,
  followUpId,
  enrolled,
  declineReasons,
  signedIn,
  contactStaff,
  onDone,
}: {
  leadId: string
  today: string
  followUpId: string | null
  enrolled: boolean
  declineReasons: readonly DeclinedReason[] | null
  signedIn: ContactStaff
  contactStaff: ContactStaff[] | null
  onDone: (message: string) => void
}) {
  // Now in Tanzania as the dialog opened: the default and the latest time
  // the form offers.
  const [now] = useState(() => tanzaniaNowLocal())
  const [comment, setComment] = useState("")
  const [method, setMethod] = useState<string>(CONTACT_METHODS[0])
  const [contactedBy, setContactedBy] = useState(signedIn.id)
  const [contactedAt, setContactedAt] = useState(now)
  // An Enrolled lead needs no next date, so none is suggested.
  const [nextDueOn, setNextDueOn] = useState(enrolled ? "" : addDays(today, 7))
  const [nextNote, setNextNote] = useState("")
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState<DeclinedReason | "">("")
  const [declineNote, setDeclineNote] = useState("")
  const { refusal, pending, save, refuse } = useSave(onDone)
  const outcomeName = useId()

  const people = contactStaff ?? [signedIn]
  const choices = people.some((person) => person.id === signedIn.id) ? people : [signedIn, ...people]

  return (
    <form
      aria-label="Record follow-up"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (declining) {
          if (declineReason === "") {
            refuse({ status: "refused", field: "decline_reason", message: "Choose a Declined reason." })
            return
          }
          if (declineReason === "Other" && declineNote.trim() === "") {
            refuse({ status: "refused", field: "decline_note", message: "Write an explanation for Other." })
            return
          }
          const decline = { reason: declineReason, note: declineNote }
          save(() =>
            recordLeadFollowUp(leadId, { followUpId, comment, method, contactedBy, contactedAt, nextDueOn: "", nextNote: "", decline }),
          )
          return
        }
        // A page left open past midnight in Tanzania would offer a next date the
        // database now counts as today.
        if (nextDueOn && nextDueOn <= laterOf(today, tanzaniaToday())) {
          refuse({ status: "refused", field: "next_due_on", message: "Pick a next date after today. If this page was open overnight, today has moved on." })
          return
        }
        save(() =>
          recordLeadFollowUp(leadId, { followUpId, comment, method, contactedBy, contactedAt, nextDueOn, nextNote }),
        )
      }}
    >
      <DialogHeader>
        <DialogTitle>Record follow-up</DialogTitle>
        <DialogDescription>
          {followUpId
            ? "What happened when the family was contacted. Recording it completes the current follow-up."
            : "A contact nobody planned, such as the family phoning in."}
        </DialogDescription>
      </DialogHeader>
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col items-start gap-2">
            {refusal.message}
            {/* Someone else recorded or changed the follow-up first. */}
            {refusal.conflict && (
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <Field label="Comment" hint="What was discussed. Keep it to what admissions needs.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            required
            minLength={3}
            maxLength={2000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "comment" ? true : undefined}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact method">
          {({ id }) => (
            <select
              id={id}
              className={SELECT_CLASS}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              aria-invalid={refusal?.field === "method" ? true : undefined}
            >
              {CONTACT_METHODS.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Made the contact">
          {({ id }) => (
            <select
              id={id}
              className={SELECT_CLASS}
              value={contactedBy}
              onChange={(event) => setContactedBy(event.target.value)}
              aria-invalid={refusal?.field === "contacted_by" ? true : undefined}
            >
              {choices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="When" hint="Tanzania time. Not later than now.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="datetime-local"
            required
            max={now}
            value={contactedAt}
            onChange={(event) => setContactedAt(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "contacted_at" ? true : undefined}
          />
        )}
      </Field>
      {declineReasons && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-900">Outcome</legend>
          {([false, true] as const).map((value) => (
            <Label key={String(value)} className="flex items-center gap-2 font-normal">
              <input
                type="radio"
                name={outcomeName}
                checked={declining === value}
                onChange={() => setDeclining(value)}
                className="size-4 shrink-0 accent-primary"
              />
              {value ? DECLINE_OUTCOME : "Plan the next follow-up"}
            </Label>
          ))}
        </fieldset>
      )}
      {declining && declineReasons ? (
        <>
          <Field label="Declined reason">
            {({ id }) => (
              <select
                id={id}
                className={SELECT_CLASS}
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value as DeclinedReason | "")}
                aria-invalid={refusal?.field === "decline_reason" ? true : undefined}
              >
                <option value="" disabled>
                  Choose a reason
                </option>
                {declineReasons.map((choice) => (
                  <option key={choice}>{choice}</option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Explanation"
            hint={declineReason === "Other" ? "Required for Other." : "Optional. Anything the reason alone doesn't say."}
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                maxLength={DECLINE_EXPLANATION_MAX}
                value={declineNote}
                onChange={(event) => setDeclineNote(event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={refusal?.field === "decline_note" ? true : undefined}
              />
            )}
          </Field>
          <p className="text-sm text-muted-foreground">{DECLINE_CONSEQUENCE}</p>
        </>
      ) : (
        <>
          <Field
            label={enrolled ? "Next follow-up date (optional)" : "Next follow-up date"}
            hint={
              enrolled
                ? "The lead is Enrolled, so a next date is optional. Any day after today, up to one year ahead."
                : "Any day after today, up to one year ahead."
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="date"
                required={!enrolled}
                min={addDays(today, 1)}
                max={addDays(today, 365)}
                value={nextDueOn}
                onChange={(event) => setNextDueOn(event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={refusal?.field === "next_due_on" || refusal?.field === "outcome" ? true : undefined}
              />
            )}
          </Field>
          <Field label="Next follow-up note (optional)" hint="What the next contact is for. Up to 500 characters.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                maxLength={500}
                value={nextNote}
                disabled={enrolled && nextDueOn === ""}
                onChange={(event) => setNextNote(event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={refusal?.field === "next_note" ? true : undefined}
              />
            )}
          </Field>
        </>
      )}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : declining ? "Record and decline" : "Record follow-up"}
        </Button>
      </DialogFooter>
    </form>
  )
}
