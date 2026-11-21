"use client"

import { useEffect, useId, useRef, useState } from "react"

import { StudentNameBoxes, type StudentName } from "@/components/guided-form/names"
import { Button, FieldError, Sheet, toast } from "@/components/kit"

import { useFatherNameFlow } from "../applicants/[id]/father-flow"
import { clean, norm } from "../applicants/[id]/father-school"
import type { SiblingPerson } from "../applicants/[id]/sibling-read"
import { nameParts, studentNameOf, withOwnName } from "./model"
import { saveStudent, useSheetSave } from "./saving"

// Change the name (#512, prototype v54): the student's own name and the
// father's three names, as on the birth certificate.
//
// - Only the student's own name changed: the rest of the stored name is kept
//   word for word (withOwnName), so a last name of two words is never cut.
// - The father's name changed: it saves first, through the record's father
//   flow, so a name close to a sibling's asks "One name, or two?" first. The
//   student's name then follows, built from the boxes. When the desk chose
//   the sibling's spelling, it is split as the sibling's own name shows.
// - Any refusal opens the sheet again with what was typed, saying what was
//   saved. Once the father's name is saved, Save sends the student's alone.
//
// The card mounts the sheet afresh each time Change opens it, so it starts
// from the record as it is then, and keeps that as what the boxes are
// compared with, whatever a later page refresh brings.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name", student: "Student’s name", father: "Father’s name" }

// The father flow's message when nothing else changed with the name.
const PLAIN = "Father’s name saved."

type Typed = { first: string; ff: string; fm: string; fl: string }

const typedOf = (n: StudentName): Typed => ({ first: clean(n.firstName), ff: clean(n.fatherFirst), fm: clean(n.fatherMiddle), fl: clean(n.fatherLast) })
const fatherOf = (t: Typed) => [t.ff, t.fm, t.fl].filter(Boolean).join(" ")

export function NameSheet({
  leadId,
  studentName,
  father,
  enrolled,
  compareWith,
  open,
  onOpenChange,
  onBusy,
}: {
  leadId: string
  studentName: string
  father: string | null
  enrolled: boolean
  compareWith: SiblingPerson | null
  open: boolean
  onOpenChange: (open: boolean) => void
  // Told while a save runs, so the card keeps this sheet and opens no other.
  onBusy: (busy: boolean) => void
}) {
  // The record as the sheet opened, and the boxes it gave.
  const [opened] = useState(() => ({ studentName, father, parts: nameParts(studentName, father) }))
  const [name, setName] = useState<StudentName>(opened.parts)
  const [touched, setTouched] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  // The father's name this sheet saved. From then on it is the name the boxes are compared with.
  const [fatherSaved, setFatherSaved] = useState<string | null>(null)
  // A refusal opens the sheet again, once no sheet of the father flow is in front.
  const [recover, setRecover] = useState(false)
  const { pending: renaming, problem, setProblem, run } = useSheetSave()
  // What was sent, for the student's name once the father's is saved.
  const sent = useRef<Typed | null>(null)
  const errorId = useId()

  const fatherChanged = (t: Typed) => norm(fatherOf(t)) !== norm(fatherSaved ?? opened.father)
  // The student's full name the boxes give.
  const fullNameOf = (t: Typed) =>
    (fatherSaved === null && !fatherChanged(t) ? withOwnName(opened.studentName, opened.parts.firstName, t.first) : null) ??
    studentNameOf(t.first, t.ff, t.fl)

  function close() {
    setRecover(false)
    onOpenChange(false)
  }

  // The student's name after the father's is saved: from the boxes as typed, or, when the desk chose the
  // sibling's spelling, from that spelling split as the sibling's own name shows it.
  function renameAfter(savedFather: string, message: string | null, siblingStudentName: string | undefined) {
    const typed = sent.current
    if (!typed) return
    setFatherSaved(savedFather)
    const asTyped = norm(savedFather) === norm(fatherOf(typed))
    const theirs = nameParts(siblingStudentName ?? "", savedFather)
    const built = asTyped ? studentNameOf(typed.first, typed.ff, typed.fl) : studentNameOf(typed.first, theirs.fatherFirst, theirs.fatherLast)
    close()
    if (norm(built) === norm(opened.studentName)) {
      if (message) toast(message)
      return
    }
    run(
      () => saveStudent(leadId, { studentName: built }),
      // With no message, a sheet saying what changed with the father's name is open: that is the confirmation.
      () => {
        if (message) toast(message === PLAIN ? "Name saved. The sibling check runs again." : message)
      },
      (reason) => {
        // The father's name is on the record now. The boxes take the spelling saved, so Save tries the student's name alone.
        if (!asTyped) setName((n) => ({ ...n, fatherFirst: theirs.fatherFirst, fatherMiddle: theirs.fatherMiddle, fatherLast: theirs.fatherLast }))
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
    onSaved: ({ father: saved, message, siblingStudentName }) => renameAfter(saved, message, siblingStudentName),
    onRefused: (reason) => {
      setBad(reason)
      setRecover(true)
    },
    onAsk: close,
  })
  const pending = renaming || flow.pending
  useEffect(() => {
    onBusy(pending)
  }, [onBusy, pending])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const typed = typedOf(name)
    const changed = fatherChanged(typed)
    // The father's three names are asked for only when his name changes.
    if (typed.first === "" || (changed && [typed.ff, typed.fm, typed.fl].some((part) => part === ""))) {
      return setBad("Type the student’s name and all three of the father’s names.")
    }
    const built = fullNameOf(typed)
    if (!touched || (!changed && norm(built) === norm(opened.studentName))) {
      close()
      toast("Nothing changed.")
      return
    }
    setBad(null)
    setProblem(null)
    sent.current = typed
    if (changed) return flow.send(fatherOf(typed))
    run(
      () => saveStudent(leadId, { studentName: built }),
      () => {
        close()
        toast("Name saved.")
      },
    )
  }

  const draft = typedOf(name)
  const full = draft.first ? fullNameOf(draft) : ""
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
          <StudentNameBoxes
            id={`${leadId}-name`}
            labels={NAME_LABELS}
            value={name}
            maxLength={60}
            disabled={pending}
            invalid={bad ? { firstName: !name.firstName.trim(), fatherFirst: !name.fatherFirst.trim(), fatherMiddle: !name.fatherMiddle.trim(), fatherLast: !name.fatherLast.trim() } : undefined}
            aria-describedby={shown ? errorId : undefined}
            onChange={(next) => {
              setName(next)
              setTouched(true)
              setBad(null)
              setProblem(null)
            }}
          />
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
