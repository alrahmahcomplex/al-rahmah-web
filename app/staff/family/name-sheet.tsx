"use client"

import { useEffect, useId, useRef, useState } from "react"

import { LastNameChoice, StudentNameBoxes, type StudentName } from "@/components/guided-form"
import { Button, FieldError, Sheet, toast } from "@/components/kit"
import type { LastNameFrom } from "@/lib/names"

import { useFatherNameFlow } from "../applicants/[id]/father-flow"
import { clean, norm } from "../applicants/[id]/father-school"
import type { SiblingPerson } from "../applicants/[id]/sibling-read"
import { nameParts, studentNameOf, withOwnName } from "./model"
import { saveStudent, useSheetSave } from "./saving"

// Change the name (#512, prototype v54): the student's own name, the father's
// three names as on the birth certificate, and which of the father's names
// ends the student's name (his last name or his middle name, #511).
//
// - When all four parts are present and the built name matches the kept rest
//   of the stored name, saves go through updateLeadDetails `nameParts` so
//   `last_name_from` is stored or preserved.
// - When the father's first name and the chosen last-name part didn't change
//   (only the other father part, or only the student's own name), the stored
//   rest of the student's name is kept word for word (withOwnName), so a
//   mismatched or imported spelling is never shortened or rewritten.
// - When the father's name changes, it saves first through the record's father
//   flow so a name close to a sibling's asks "One name, or two?" first. The
//   student's name and last-name choice follow once the father's name is saved.
// - Any refusal opens the sheet again with what was typed, saying what was
//   saved. Once the father's name is saved, Save sends the student's alone.
//
// The card mounts the sheet afresh each time Change opens it, so it starts
// from the record as it is then, and keeps that as what the boxes are
// compared with, whatever a later page refresh brings.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name", student: "Student’s name", father: "Father’s name" }
const LAST_NAME_LABELS = { group: "Student’s last name", last: "Father’s last name", middle: "Father’s middle name" }

// The father flow's message when nothing else changed with the name.
const PLAIN = "Father’s name saved."

type Typed = { first: string; ff: string; fm: string; fl: string }

const typedOf = (n: StudentName): Typed => ({ first: clean(n.firstName), ff: clean(n.fatherFirst), fm: clean(n.fatherMiddle), fl: clean(n.fatherLast) })
const fatherOf = (t: Typed) => [t.ff, t.fm, t.fl].filter(Boolean).join(" ")
const hasAllFour = (t: Typed) => t.first !== "" && t.ff !== "" && t.fm !== "" && t.fl !== ""
const pickedLastOf = (fm: string, fl: string, from: LastNameFrom) => (from === "father_middle" ? fm : fl)

export type NameBusy = false | "saving" | "refreshing"

export function NameSheet({
  leadId,
  studentName,
  father,
  lastNameFrom,
  enrolled,
  compareWith,
  open,
  onOpenChange,
  onBusy,
}: {
  leadId: string
  studentName: string
  father: string | null
  lastNameFrom: LastNameFrom | null
  enrolled: boolean
  compareWith: SiblingPerson | null
  open: boolean
  onOpenChange: (open: boolean) => void
  // Told while a save or its refresh runs, so the card keeps this sheet and opens no other from stale props.
  onBusy: (busy: NameBusy) => void
}) {
  // The record as the sheet opened, and the boxes it gave.
  const [opened] = useState(() => {
    const initialFrom: LastNameFrom = lastNameFrom === "father_middle" ? "father_middle" : "father_last"
    return { studentName, father, lastNameFrom, initialFrom, parts: nameParts(studentName, father, lastNameFrom) }
  })
  const [name, setName] = useState<StudentName>(opened.parts)
  const [from, setFrom] = useState<LastNameFrom>(opened.initialFrom)
  const [touched, setTouched] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  // The father's name (and last-name choice) this sheet saved. From then on the boxes compare with it.
  const [fatherSaved, setFatherSaved] = useState<{ father: string; from: LastNameFrom } | null>(null)
  // A refusal opens the sheet again, once no sheet of the father flow is in front.
  const [recover, setRecover] = useState(false)
  const { pending: renaming, refreshing, problem, setProblem, run, refresh } = useSheetSave()
  // What was sent, for the student's name once the father's is saved.
  const sent = useRef<{ typed: Typed; from: LastNameFrom } | null>(null)
  const errorId = useId()

  const fatherChanged = (t: Typed) => norm(fatherOf(t)) !== norm(fatherSaved?.father ?? opened.father)
  const samePicked = (ff: string, fm: string, fl: string, nextFrom: LastNameFrom) =>
    nextFrom === opened.initialFrom &&
    norm(ff) === norm(opened.parts.fatherFirst) &&
    norm(pickedLastOf(fm, fl, nextFrom)) === norm(pickedLastOf(opened.parts.fatherMiddle, opened.parts.fatherLast, opened.initialFrom))

  // The student's full name for these parts: when the choice and the father parts used in the
  // student's name did not change, keep the stored rest of the student's name so a two-word last
  // name or an imported spelling is never shortened or rewritten. Under `father_middle`, when the
  // student's own name changes on a mismatched record (e.g. after a sibling's father typo fix),
  // rebuild from the boxes so `last_name_from` is kept rather than silently cleared to null.
  const studentNameFor = (first: string, ff: string, fm: string, fl: string, nextFrom: LastNameFrom) => {
    if (samePicked(ff, fm, fl, nextFrom)) {
      if (norm(first) === norm(opened.parts.firstName)) return opened.studentName
      const kept = withOwnName(opened.studentName, opened.parts.firstName, first)
      const rebuilt = studentNameOf(first, ff, pickedLastOf(fm, fl, nextFrom))
      if (kept && (opened.lastNameFrom !== "father_middle" || !hasAllFour({ first, ff, fm, fl }) || norm(kept) === norm(rebuilt))) {
        return kept
      }
    }
    return studentNameOf(first, ff, pickedLastOf(fm, fl, nextFrom))
  }
  const fullNameOf = (t: Typed, nextFrom: LastNameFrom) => studentNameFor(t.first, t.ff, t.fm, t.fl, nextFrom)

  // Sends `nameParts` when preserving a stored choice, changing the choice, or following a father save
  // (all four parts present and building `built`); uses one-box `studentName` for legacy leads with
  // no stored choice (`lastNameFrom === null`) or mismatched/two-word fathers so father fields stay untouched.
  const studentChangeFor = (t: Typed, nextFrom: LastNameFrom, built: string, fatherJustSaved: boolean) => {
    const wantsParts = opened.lastNameFrom !== null || nextFrom !== opened.initialFrom || fatherJustSaved
    return wantsParts && hasAllFour(t) && norm(built) === norm(studentNameOf(t.first, t.ff, pickedLastOf(t.fm, t.fl, nextFrom)))
      ? { nameParts: { firstName: t.first, fatherFirst: t.ff, fatherMiddle: t.fm, fatherLast: t.fl, lastNameFrom: nextFrom } }
      : { studentName: built }
  }

  function close() {
    setRecover(false)
    onOpenChange(false)
  }

  // The student's name after the father's is saved: from the boxes as typed, or, when the desk chose the
  // sibling's spelling, from that spelling split as the sibling's own name and last-name choice show it.
  function renameAfter(
    savedFather: string,
    message: string | null,
    siblingStudentName: string | undefined,
    siblingLastNameFrom: LastNameFrom | null | undefined,
  ) {
    const attempt = sent.current
    if (!attempt) return
    const { typed, from: typedFrom } = attempt
    const asTyped = norm(savedFather) === norm(fatherOf(typed))
    const theirs = nameParts(siblingStudentName ?? "", savedFather, siblingLastNameFrom)
    const effectiveFrom: LastNameFrom = asTyped || theirs.fatherMiddle !== "" ? typedFrom : "father_last"
    setFatherSaved({ father: savedFather, from: effectiveFrom })
    const parts: Typed = asTyped
      ? typed
      : { first: typed.first, ff: theirs.fatherFirst, fm: theirs.fatherMiddle, fl: theirs.fatherLast }
    const built = studentNameFor(parts.first, parts.ff, parts.fm, parts.fl, effectiveFrom)
    close()
    if (norm(built) === norm(opened.studentName) && effectiveFrom === opened.initialFrom) {
      if (message) toast(message)
      return
    }
    run(
      () => saveStudent(leadId, studentChangeFor(parts, effectiveFrom, built, true)),
      // With no message, a sheet saying what changed with the father's name is open: that is the confirmation.
      () => {
        if (message) toast(message === PLAIN ? "Name saved. The sibling check runs again." : message)
      },
      (reason) => {
        // The father's name is on the record now. The boxes take the spelling saved, so Save tries the student's name alone.
        if (!asTyped) {
          setName((n) => ({ ...n, fatherFirst: theirs.fatherFirst, fatherMiddle: theirs.fatherMiddle, fatherLast: theirs.fatherLast }))
          setFrom(effectiveFrom)
        }
        setProblem(`The father’s name was saved, but the student’s name was not. ${reason}`)
        setRecover(true)
      },
    )
  }

  const flow = useFatherNameFlow({
    leadId,
    studentName,
    father,
    enrolled,
    compareWith,
    onChanged: refresh,
    onSaved: ({ father: saved, message, siblingStudentName, siblingLastNameFrom }) =>
      renameAfter(saved, message, siblingStudentName, siblingLastNameFrom),
    onRefused: (reason) => {
      setBad(reason)
      setRecover(true)
    },
    onAsk: close,
  })
  const pending = renaming || flow.pending
  useEffect(() => {
    onBusy(pending ? "saving" : refreshing ? "refreshing" : false)
  }, [onBusy, pending, refreshing])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const typed = typedOf(name)
    const changed = fatherChanged(typed)
    const choiceChanged = from !== (fatherSaved?.from ?? opened.initialFrom)
    // All three of the father's names are required when his name or the last-name choice changes.
    if (typed.first === "" || ((changed || choiceChanged) && !hasAllFour(typed))) {
      return setBad("Type the student’s name and all three of the father’s names.")
    }
    const built = fullNameOf(typed, from)
    if (!touched || (!changed && norm(built) === norm(opened.studentName) && from === opened.initialFrom)) {
      close()
      toast("Nothing changed.")
      return
    }
    setBad(null)
    setProblem(null)
    sent.current = { typed, from }
    if (changed) return flow.send(fatherOf(typed))
    run(
      () => saveStudent(leadId, studentChangeFor(typed, from, built, fatherSaved !== null)),
      () => {
        close()
        toast("Name saved.")
      },
    )
  }

  const draft = typedOf(name)
  const needsFatherParts = fatherChanged(draft) || from !== (fatherSaved?.from ?? opened.initialFrom)
  const full = draft.first ? fullNameOf(draft, from) : ""
  const formId = `${errorId}-form`
  const shown = bad ?? problem
  return (
    <>
      <Sheet
        open={open || (recover && !flow.showing && !pending)}
        onOpenChange={(next) => {
          if (pending) return
          if (next) onOpenChange(true)
          else close()
        }}
        placement="centre"
        title="Change the name"
        hint="As it is on the birth certificate."
        closeLabel="Close"
        foot={
          <Button type="submit" form={formId} size="wide" chevron pending={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        }
      >
        <form id={formId} noValidate onSubmit={submit} className="fam-form">
          <fieldset disabled={pending} className="fam-form m-0 min-w-0 border-0 p-0">
            <StudentNameBoxes
              id={`${leadId}-name`}
              labels={NAME_LABELS}
              value={name}
              maxLength={60}
              disabled={pending}
              invalid={
                bad
                  ? {
                      firstName: !name.firstName.trim(),
                      fatherFirst: needsFatherParts && !name.fatherFirst.trim(),
                      fatherMiddle: needsFatherParts && !name.fatherMiddle.trim(),
                      fatherLast: needsFatherParts && !name.fatherLast.trim(),
                    }
                  : undefined
              }
              aria-describedby={shown ? errorId : undefined}
              onChange={(next) => {
                setName(next)
                setTouched(true)
                setBad(null)
                setProblem(null)
              }}
            />
            <LastNameChoice
              name={`${leadId}-last-name`}
              father={name}
              value={from}
              labels={LAST_NAME_LABELS}
              onChange={(next) => {
                setFrom(next)
                setTouched(true)
                setBad(null)
                setProblem(null)
              }}
            />
          </fieldset>
          <p className="fam-live" aria-live="polite">
            {full && (
              <>
                Student’s full name: <b>{full}</b>
              </>
            )}
          </p>
          <FieldError id={errorId} message={shown ?? undefined} />
        </form>
      </Sheet>
      {flow.sheets}
    </>
  )
}
