"use client"

import { useId, useRef, useState, useTransition } from "react"

import { Button, ChoiceTiles, Note, Sheet, TextLink, toast } from "@/components/kit"
import { STUDENT_GENDERS, type LeadClass, type StudentGender } from "@/lib/services/leads"
import type { GenderOutlook } from "@/lib/services/streams"

import type { CorrectionOutcome } from "./correction-outcome"
import { correctGender, genderOutlookAction } from "./gender-actions"
import { firstName, genderHint, genderMoveWarning } from "./seat-text"

// Give the answer, or Change, beside Boy or girl on Student details (#449,
// v42). Before saving, a change that moves a placed child out of their
// stream says where they would go. An answer can be changed, never cleared.
//
// Every change asks the database what it does to the seat, whether or not
// the page read streams as on: that read falls back to legacy when it fails,
// and the database answers for both modes (before streams are on, nothing
// moves). When that answer can't be read, the server action answers "nothing
// moves" only if it has confirmed that streams are off.

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."
// When what the change does to the seat can’t be read and streams are not confirmed off, nothing is saved unwarned.
const UNREAD = "Some details could not be read. Reload the page and try again."

export function GenderSheet({
  leadId,
  studentName,
  className,
  gender,
  onSaved,
}: {
  leadId: string
  studentName: string
  className: LeadClass
  gender: StudentGender | null
  // After a save, for a page the save does not refresh itself (the Family page).
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<StudentGender | null>(gender)
  // Counts every opening and every pick: a read applies only if nothing
  // happened since it was sent, so a late reply (an earlier pick, or one
  // sent before the sheet was closed and opened again) is dropped.
  const asked = useRef(0)
  const [move, setMove] = useState<(GenderOutlook & { for: StudentGender }) | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // The pick whose read Save is waiting for, by its number in `asked`. Only
  // that read ends the wait, so one left behind by a newer pick, or by the
  // sheet closing and opening again, never holds Save.
  const [readingFor, setReadingFor] = useState<number | null>(null)
  const id = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (next) {
      setPicked(gender)
      asked.current += 1
      setMove(null)
      setProblem(null)
      setReadingFor(null)
    }
  }

  function pick(value: string) {
    // The answer being saved stays the one picked until the save answers.
    if (pending) return
    const answer = value as StudentGender
    const ask = ++asked.current
    setPicked(answer)
    setProblem(null)
    setMove(null)
    if (answer === gender) return setReadingFor(null)
    setReadingFor(ask)
    void readMove(answer).then((outlook) => {
      if (asked.current !== ask) return
      setMove(outlook ? { ...outlook, for: answer } : null)
      setReadingFor(null)
    })
  }

  async function readMove(answer: StudentGender): Promise<GenderOutlook | null> {
    try {
      return await genderOutlookAction(leadId, answer)
    } catch {
      return null
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!picked) return setProblem("Choose Boy or Girl.")
    if (picked === gender) return setOpen(false)
    const answer = picked
    startTransition(async () => {
      // Save goes ahead only after what the change does to the seat has been
      // read for this answer, and its warning shown.
      if (move?.for !== answer) {
        const outlook = await readMove(answer)
        if (!outlook) return setProblem(UNREAD)
        setMove({ ...outlook, for: answer })
        if (outlook.moves && outlook.placed) return
      }
      let outcome: CorrectionOutcome
      try {
        outcome = await correctGender(leadId, answer)
      } catch {
        outcome = { status: "refused", field: null, message: LOST }
      }
      if (outcome.status === "saved") {
        setOpen(false)
        toast(`Saved: ${answer}.`)
        onSaved?.()
        return
      }
      setProblem(outcome.status === "refused" ? outcome.message : LOST)
    })
  }

  const warning = move && move.for === picked && move.moves && move.placed ? genderMoveWarning({ studentName, className }, picked, { placed: move.placed, wouldTake: move.wouldTake }) : null
  return (
    <>
      <TextLink onClick={() => changeOpen(true)}>{gender ? "Change" : "Give the answer"}</TextLink>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Is ${firstName({ studentName })} a boy or a girl?`}
        hint={`${studentName} · ${className}`}
        closeLabel="Close"
        foot={
          <Button type="submit" form={`${id}-form`} size="wide" disabled={pending || readingFor !== null}>
            {pending ? "Saving…" : "Save"}
          </Button>
        }
      >
        <form id={`${id}-form`} className="lr-form" onSubmit={submit} noValidate>
          {/* A disabled fieldset disables every radio inside it while the save runs. */}
          <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
            <ChoiceTiles
              name={`${id}-gender`}
              legend={<span className="lr-label">Boy or girl</span>}
              layout="two"
              options={STUDENT_GENDERS.map((value) => ({ value, label: value }))}
              value={picked ?? ""}
              onChange={pick}
            />
          </fieldset>
          <p className="lr-hint">{genderHint({ studentName, gender })}</p>
          {warning && (
            <Note tone="wait" role="status">
              <span>
                <b>{warning.title}</b> {warning.text}
              </span>
            </Note>
          )}
          {problem && (
            <Note tone="bad" role="alert">
              {problem}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}
