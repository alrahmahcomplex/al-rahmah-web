"use client"

import { useId, useState, useTransition } from "react"

import { StudentNameBoxes, type StudentName } from "@/components/guided-form/names"
import { Button, FieldError, Sheet, toast } from "@/components/kit"

import { useFatherNameFlow } from "../applicants/[id]/father-flow"
import { clean, norm, partsOf } from "../applicants/[id]/father-school"
import type { SiblingPerson } from "../applicants/[id]/sibling-read"
import { ownName, studentNameOf } from "./model"
import { refusalText, saveStudent, useSheetSave, type StudentDetails } from "./saving"

// Change the name (#512, prototype v54): the student's own name and the
// father's three names, as on the birth certificate. The student's full name
// is built from them. A changed father's name saves first, through the
// record's father flow, so a name close to a sibling's asks "One name, or
// two?" first; the student's name follows once the father's is saved.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name", student: "Student’s name", father: "Father’s name" }

// The father flow’s message when nothing else changed with the name.
const PLAIN = "Father’s name saved."

const wordsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean)

export function NameSheet({
  details,
  father,
  enrolled,
  compareWith,
  open,
  onOpenChange,
}: {
  details: StudentDetails
  father: string | null
  enrolled: boolean
  compareWith: SiblingPerson | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const start = (): StudentName => ({ firstName: ownName(details.studentName, father), ...partsOf(father) })
  const [name, setName] = useState<StudentName>(start)
  const [touched, setTouched] = useState(false)
  const [bad, setBad] = useState<string | null>(null)
  const { pending: renaming, problem, setProblem, run, refresh } = useSheetSave()
  const [, startRename] = useTransition()
  const errorId = useId()

  // The student's name after the father's is saved, from the name now on the record.
  function renameAfter(savedFather: string, message: string | null) {
    const parts = wordsOf(savedFather)
    const built = studentNameOf(clean(name.firstName), parts[0] ?? "", parts.at(-1) ?? "")
    onOpenChange(false)
    if (norm(built) === norm(details.studentName)) {
      if (message) toast(message)
      return
    }
    startRename(async () => {
      const outcome = await saveStudent(details, { studentName: built })
      if (outcome.status === "saved") {
        // With no message, a sheet saying what changed with the father’s name is open: that is the confirmation.
        if (message) toast(message === PLAIN ? "Name saved. The sibling check runs again." : message)
        refresh()
      } else toast(`The father’s name was saved, but the student’s name was not. ${refusalText(outcome)}`, { tone: "bad" })
    })
  }

  const flow = useFatherNameFlow({
    leadId: details.leadId,
    studentName: details.studentName,
    father,
    enrolled,
    compareWith,
    onSaved: ({ father: saved, message }) => renameAfter(saved, message),
    onRefused: setBad,
    onAsk: () => onOpenChange(false),
  })
  const pending = renaming || flow.pending

  function changeOpen(next: boolean) {
    if (pending) return
    if (next) {
      setName(start())
      setTouched(false)
      setBad(null)
      setProblem(null)
    }
    onOpenChange(next)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const typed = { first: clean(name.firstName), ff: clean(name.fatherFirst), fm: clean(name.fatherMiddle), fl: clean(name.fatherLast) }
    if (Object.values(typed).some((part) => part === "")) return setBad("Type the student’s name and all three of the father’s names.")
    const fatherName = [typed.ff, typed.fm, typed.fl].join(" ")
    const built = studentNameOf(typed.first, typed.ff, typed.fl)
    const fatherChanged = norm(fatherName) !== norm(father)
    if (!touched || (!fatherChanged && norm(built) === norm(details.studentName))) {
      onOpenChange(false)
      toast("Nothing changed.")
      return
    }
    setBad(null)
    setProblem(null)
    if (fatherChanged) return flow.send(fatherName)
    run(
      () => saveStudent(details, { studentName: built }),
      () => {
        onOpenChange(false)
        toast("Name saved.")
      },
    )
  }

  const full = [name.firstName, name.fatherFirst, name.fatherLast].map(clean).filter(Boolean).join(" ")
  const formId = `${errorId}-form`
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
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
            id={`${details.leadId}-name`}
            labels={NAME_LABELS}
            value={name}
            maxLength={60}
            disabled={pending}
            invalid={bad ? { firstName: !name.firstName.trim(), fatherFirst: !name.fatherFirst.trim(), fatherMiddle: !name.fatherMiddle.trim(), fatherLast: !name.fatherLast.trim() } : undefined}
            aria-describedby={bad || problem ? errorId : undefined}
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
          <FieldError id={errorId} message={bad ?? problem ?? undefined} />
        </form>
      </Sheet>
      {flow.sheets}
    </>
  )
}
