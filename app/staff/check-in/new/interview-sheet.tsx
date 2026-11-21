"use client"

import { useRef, useState } from "react"

import { Icon } from "@/components/icons"
import { Button, Note, Sheet, Tag, toast } from "@/components/kit"
import type { LeadClass } from "@/lib/services/leads"

import { registerInterviewFromFinish } from "./interview-actions"
import { firstOf } from "./model"

// Register for interview on the finished screen of Register students and
// Check-in (#511, prototype v55): one button per saved student, and Register
// all for two or more still to register. The state lives here so the sheet
// and the finished list's chips read the same answers.

export type InterviewStudent = { leadId: string; admissionNumber: string; name: string; className: LeadClass }

export function useInterviewRegistration(students: readonly InterviewStudent[] | null) {
  const [open, setOpen] = useState(false)
  const [interviewed, setInterviewed] = useState<Record<string, boolean>>({})
  const [busyOne, setBusyOne] = useState<Record<string, boolean>>({})
  const [busyAll, setBusyAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Start over or another family: answers still on their way are dropped.
  const round = useRef(0)

  const remaining = students ? students.filter((s) => !interviewed[s.leadId]) : []
  const showAll = !!students && students.length > 1 && remaining.length > 0
  const busy = busyAll || Object.values(busyOne).some(Boolean)

  function reset() {
    round.current += 1
    setOpen(false)
    setInterviewed({})
    setBusyOne({})
    setBusyAll(false)
    setError(null)
  }

  function openSheet() {
    setError(null)
    setOpen(true)
  }

  async function registerOne(student: InterviewStudent) {
    if (busyAll || busyOne[student.leadId] || interviewed[student.leadId]) return
    const mine = round.current
    setError(null)
    setBusyOne((m) => ({ ...m, [student.leadId]: true }))
    try {
      const outcome = await registerInterviewFromFinish(student.leadId)
      if (mine !== round.current) return
      if (outcome.status === "registered" || outcome.status === "already") {
        setInterviewed((m) => ({ ...m, [student.leadId]: true }))
        toast(outcome.status === "already" ? `${firstOf(student.name)} was already on the interview list.` : `${firstOf(student.name)} is on the interview list.`)
      } else {
        setError(`${student.name}: ${outcome.message}`)
      }
    } catch {
      if (mine !== round.current) return
      setError(`${student.name}: The registration could not be saved. Try again in a moment.`)
    } finally {
      if (mine === round.current) setBusyOne((m) => ({ ...m, [student.leadId]: false }))
    }
  }

  async function registerAll() {
    if (!students || busy) return
    const left = students.filter((s) => !interviewed[s.leadId])
    if (left.length === 0) return
    const mine = round.current
    setError(null)
    setBusyAll(true)
    let done = 0
    let firstDone: InterviewStudent | null = null
    const errors: string[] = []
    try {
      for (const s of left) {
        if (mine !== round.current) return
        try {
          const outcome = await registerInterviewFromFinish(s.leadId)
          if (mine !== round.current) return
          if (outcome.status === "registered") {
            done += 1
            if (!firstDone) firstDone = s
            setInterviewed((m) => ({ ...m, [s.leadId]: true }))
          } else if (outcome.status === "already") {
            // Put on the list by someone else since the form was saved: done, not retried.
            setInterviewed((m) => ({ ...m, [s.leadId]: true }))
          } else {
            errors.push(`${s.name}: ${outcome.message}`)
          }
        } catch {
          if (mine !== round.current) return
          errors.push(`${s.name}: The registration could not be saved.`)
        }
      }
      if (mine !== round.current) return
      if (done > 0) {
        toast(done > 1 ? `${done} students are on the interview list.` : `${firstOf(firstDone!.name)} is on the interview list.`)
      }
      if (errors.length > 0) setError(errors.join(" "))
    } finally {
      if (mine === round.current) setBusyAll(false)
    }
  }

  return { open, setOpen, openSheet, interviewed, busyOne, busyAll, busy, error, remaining, showAll, reset, registerOne, registerAll }
}

export type InterviewRegistration = ReturnType<typeof useInterviewRegistration>

/** The green chip with a tick, in the sheet and on the finished list. */
export function RegisteredChip() {
  return (
    <Tag tone="ok" className="rs-iv-chip">
      <Icon name="check" size={16} />
      Registered for interview
    </Tag>
  )
}

export function InterviewSheet({ reg, students }: { reg: InterviewRegistration; students: readonly InterviewStudent[] | null }) {
  return (
    <Sheet
      open={reg.open && !!students}
      onOpenChange={(next) => {
        if (!reg.busy) reg.setOpen(next)
      }}
      placement="centre"
      title="Register for interview"
      hint={
        students && students.length > 1
          ? "Register each student who is ready. A student who didn’t come today can be registered later, from the family’s record."
          : "The student goes on the interview list."
      }
      closeLabel="Close"
      foot={
        <div className="rs-iv-foot">
          {reg.showAll && (
            <Button size="wide" pending={reg.busyAll} aria-disabled={reg.busy || undefined} onClick={reg.registerAll}>
              {reg.busyAll ? "Registering…" : "Register all for interview"}
            </Button>
          )}
          <Button variant="ghost" size="wide" aria-disabled={reg.busy || undefined} onClick={() => !reg.busy && reg.setOpen(false)}>
            {reg.remaining.length > 0 ? "Close" : "Done"}
          </Button>
        </div>
      }
    >
      {students && (
        <div className="rs-col">
          {reg.error && (
            <Note tone="bad" icon="alert" role="alert">
              {reg.error}
            </Note>
          )}
          <div className="rs-iv-list">
            {students.map((s) => {
              const busy = !!reg.busyOne[s.leadId]
              return (
                <div key={s.leadId} className="rs-iv-row">
                  <span className="rs-iv-tx">
                    <b>{s.name}</b>
                    <small>{`${s.className} · ${s.admissionNumber}`}</small>
                  </span>
                  <span className="rs-iv-act">
                    {reg.interviewed[s.leadId] ? (
                      <RegisteredChip />
                    ) : (
                      // One orange button per screen: outlined while Register all shows.
                      <Button
                        variant={reg.showAll ? "ghost" : "go"}
                        size="small"
                        pending={busy}
                        aria-disabled={reg.busyAll || busy || undefined}
                        onClick={() => reg.registerOne(s)}
                      >
                        {busy ? "Registering…" : "Register for interview"}
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}
