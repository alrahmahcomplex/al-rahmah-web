"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"

import { StudentNameBoxes, type StudentName } from "@/components/guided-form/names"
import { Button, FieldError, Sheet, toast } from "@/components/kit"

import { useFatherNameFlow } from "../applicants/[id]/father-flow"
import { clean, norm } from "../applicants/[id]/father-school"
import type { SiblingPerson } from "../applicants/[id]/sibling-read"
import { nameParts, studentNameOf } from "./model"
import { saveStudent, useSheetSave } from "./saving"

// Change the name (#512, prototype v54): the student's own name and the
// father's three names, as on the birth certificate. The student's full name
// is built from them. A changed father's name saves first, through the
// record's father flow, so a name close to a sibling's asks "One name, or
// two?" first; the student's name follows once the father's is saved. Any
// refusal opens the sheet again with what was typed, saying what was saved.
//
// The sheet is mounted afresh each time Change opens it (the card keys it),
// so it always starts from the record as it is now.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name", student: "Student’s name", father: "Father’s name" }

// The father flow's message when nothing else changed with the name.
const PLAIN = "Father’s name saved."

type Typed = { first: string; ff: string; fm: string; fl: string }

const wordsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean)

export function NameSheet({
  leadId,
  studentName,
  father,
  enrolled,
  compareWith,
  open,
  onOpenChange,
  busyRef,
}: {
  // Set while a save runs, so the card does not remount the sheet under it.
  busyRef: RefObject<boolean>
  leadId: string
  studentName: string
  father: string | null
  enrolled: boolean
  compareWith: SiblingPerson | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState<StudentName>(() => nameParts(studentName, father))
  const [touched, setTouched] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  const { pending: renaming, problem, setProblem, run } = useSheetSave()
  // What was sent, for the student's name once the father's is saved.
  const sent = useRef<Typed | null>(null)
  const errorId = useId()

  // The student's name after the father's is saved: the parts typed, or the
  // first and last words of the sibling's spelling when the desk chose it.
  function renameAfter(savedFather: string, message: string | null) {
    const typed = sent.current
    if (!typed) return
    const typedFather = [typed.ff, typed.fm, typed.fl].join(" ")
    const words = wordsOf(savedFather)
    const asTyped = norm(savedFather) === norm(typedFather)
    const built = asTyped ? studentNameOf(typed.first, typed.ff, typed.fl) : studentNameOf(typed.first, words[0] ?? "", words.at(-1) ?? "")
    onOpenChange(false)
    if (norm(built) === norm(studentName)) {
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
        // The father's name is on the record now. The draft takes the spelling saved, so Save tries the student's name alone.
        if (!asTyped) setName((n) => ({ ...n, fatherFirst: words[0] ?? "", fatherMiddle: words.slice(1, -1).join(" "), fatherLast: words.at(-1) ?? "" }))
        setProblem(`The father’s name was saved, but the student’s name was not. ${reason}`)
        onOpenChange(true)
      },
    )
  }

  const flow = useFatherNameFlow({
    leadId,
    studentName,
    father,
    enrolled,
    compareWith,
    onSaved: ({ father: saved, message }) => renameAfter(saved, message),
    onRefused: (reason) => {
      setBad(reason)
      onOpenChange(true)
    },
    onAsk: () => onOpenChange(false),
  })
  const pending = renaming || flow.pending
  useEffect(() => {
    busyRef.current = pending
  }, [busyRef, pending])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const typed: Typed = { first: clean(name.firstName), ff: clean(name.fatherFirst), fm: clean(name.fatherMiddle), fl: clean(name.fatherLast) }
    if (Object.values(typed).some((part) => part === "")) return setBad("Type the student’s name and all three of the father’s names.")
    const fatherName = [typed.ff, typed.fm, typed.fl].join(" ")
    const built = studentNameOf(typed.first, typed.ff, typed.fl)
    const fatherChanged = norm(fatherName) !== norm(father)
    if (!touched || (!fatherChanged && norm(built) === norm(studentName))) {
      onOpenChange(false)
      toast("Nothing changed.")
      return
    }
    setBad(null)
    setProblem(null)
    sent.current = typed
    if (fatherChanged) return flow.send(fatherName)
    run(
      () => saveStudent(leadId, { studentName: built }),
      () => {
        onOpenChange(false)
        toast("Name saved.")
      },
    )
  }

  const full = [name.firstName, name.fatherFirst, name.fatherLast].map(clean).filter(Boolean).join(" ")
  const formId = `${errorId}-form`
  const shown = bad ?? problem
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !pending && onOpenChange(next)}
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
