"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Icon } from "@/components/icons"
import { Avatar, Button, KeyValueList, StatusChip, Tag, TextLink, toast, type KeyValueItem } from "@/components/kit"
import type { LeadPreviousSchool } from "@/lib/services/lead-details"
import type { Lead } from "@/lib/services/leads"

import { NO_SCHOOL_ASKED } from "../check-in/new/model"
import { GenderSheet } from "../applicants/[id]/gender-sheet"
import { registerInterview } from "../applicants/[id]/interview-actions"
import type { SiblingPerson } from "../applicants/[id]/sibling-read"
import { BoardingSheet, ClassSheet, SchoolSheet } from "./detail-sheets"
import { NameSheet, type NameBusy } from "./name-sheet"
import type { StudentDetails } from "./saving"

// One student on the Family page (#512, prototype v54): every answer with
// its Change, and an outlined Register for interview, or the green
// "Registered for interview" chip.

export type StudentCardData = {
  lead: Lead
  father: string | null
  previousSchool: LeadPreviousSchool
  interview: "registered" | "can-register" | "none"
  compareWith: SiblingPerson | null
}

type Editing = "name" | "class" | "board" | "school" | null

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name

function schoolLine(school: LeadPreviousSchool, asked: boolean) {
  if (!asked) return <span className="fam-quiet">Not asked below STD 2</span>
  if (school?.kind === "school") return `${school.name} · ${school.type === "private" ? "Private" : "Public"} · ${school.region}`
  if (school?.kind === "not-known") return <Tag tone="wait">Not known yet</Tag>
  return <Tag tone="bad">Missing</Tag>
}

export function RegisteredChip() {
  return (
    <Tag tone="ok" className="fam-iv">
      <Icon name="check" size={16} />
      Registered for interview
    </Tag>
  )
}

export function StudentCard({ student, canEdit }: { student: StudentCardData; canEdit: boolean }) {
  const { lead } = student
  const router = useRouter()
  const [editing, setEditing] = useState<Editing>(null)
  // Each sheet's edit session. Change mounts only that sheet afresh, so opening another sheet never
  // replaces a name sheet whose father flow is still saving.
  const [session, setSession] = useState({ name: 0, class: 0, board: 0, school: 0 })
  // While the name sheet saves or its refresh is in flight, it keeps the card: no other sheet opens over it or mounts from stale props.
  const [nameBusy, setNameBusy] = useState<NameBusy>(false)
  const [registering, startRegister] = useTransition()
  const details: StudentDetails = {
    leadId: lead.id,
    studentName: lead.studentName,
    className: lead.className,
    enrollmentYear: lead.enrollmentYear,
    dayOrBoarding: lead.dayOrBoarding,
  }
  const asked = !NO_SCHOOL_ASKED.includes(lead.className)
  const change = (what: Exclude<Editing, null>, label: string) =>
    canEdit ? (
      <TextLink
        aria-label={`Change ${label} of ${lead.studentName}`}
        onClick={() => {
          // A new edit session: the sheet mounts again and starts from the record as it is now.
          // While the name sheet is saving, reopen it as-is instead of remounting; while its refresh
          // is still landing, wait so a fresh sheet never starts from pre-save props.
          if (nameBusy) {
            if (nameBusy === "saving" && what === "name") setEditing("name")
            return
          }
          setSession((n) => ({ ...n, [what]: n[what] + 1 }))
          setEditing(what)
        }}
      >
        Change
      </TextLink>
    ) : undefined
  const sheetOpen = (what: Exclude<Editing, null>) => ({
    open: editing === what,
    // A sheet opens or closes only itself: a late close never shuts another sheet, and a late reopen never covers one.
    onOpenChange: (open: boolean) => setEditing((now) => (open ? (now === null || now === what ? what : now) : now === what ? null : now)),
  })

  const rows: KeyValueItem[] = [
    { key: "Full name", value: lead.studentName, action: change("name", "the name") },
    { key: "Father", value: student.father ?? <Tag tone="line">Not recorded yet</Tag>, action: change("name", "the father’s name") },
    {
      key: "Boy or girl",
      value: lead.gender ?? <span className="fam-quiet">Not recorded yet</span>,
      action: canEdit ? (
        <GenderSheet leadId={lead.id} studentName={lead.studentName} className={lead.className} gender={lead.gender} disabled={Boolean(nameBusy)} onSaved={() => router.refresh()} />
      ) : undefined,
    },
    { key: "Class", value: lead.className, action: change("class", "the class") },
    { key: "Day or boarding", value: lead.dayOrBoarding, action: change("board", "day or boarding") },
    { key: "Previous school", value: schoolLine(student.previousSchool, asked), action: asked ? change("school", "the previous school") : undefined },
  ]
  // Every row keeps its third column, so the list stays ruled for staff who can only read.
  if (!canEdit) rows.forEach((row) => (row.action = row.action ?? null))

  function register() {
    startRegister(async () => {
      try {
        const outcome = await registerInterview(lead.id)
        if (outcome.status === "registered") {
          toast(`${firstWord(lead.studentName)} is on the interview list.`)
          router.refresh()
        } else toast(outcome.message, { tone: "bad" })
      } catch {
        toast("The registration could not be sent. Check your connection and try again.", { tone: "bad" })
      }
    })
  }

  return (
    <section className="kit-card fam-s" aria-labelledby={`fam-${lead.id}`}>
      <div className="fam-sh">
        <Avatar initials={(firstWord(lead.studentName)[0] ?? "?").toUpperCase()} size={40} />
        <div className="fam-sh-tx">
          <h2 id={`fam-${lead.id}`} className="fam-sh-name">
            {lead.studentName}
          </h2>
          <small className="kit-num">{lead.admissionNumber}</small>
        </div>
        <div className="fam-sh-chips">
          <StatusChip status={lead.closure ?? lead.status} />
          {student.interview === "registered" && <RegisteredChip />}
        </div>
      </div>
      <KeyValueList items={rows} />
      {student.interview === "can-register" && (
        <div>
          <Button variant="ghost" size="small" pending={registering} onClick={register}>
            {registering ? "Registering…" : "Register for interview"}
          </Button>
        </div>
      )}
      {canEdit && (
        <>
          <NameSheet
            key={`name-${session.name}`}
            onBusy={setNameBusy}
            leadId={lead.id}
            studentName={lead.studentName}
            father={student.father}
            enrolled={lead.status === "Enrolled"}
            compareWith={student.compareWith}
            {...sheetOpen("name")}
          />
          <ClassSheet key={`class-${session.class}`} details={details} {...sheetOpen("class")} />
          <BoardingSheet key={`board-${session.board}`} details={details} {...sheetOpen("board")} />
          {asked && <SchoolSheet key={`school-${session.school}`} leadId={lead.id} studentName={lead.studentName} school={student.previousSchool} {...sheetOpen("school")} />}
        </>
      )}
    </section>
  )
}
