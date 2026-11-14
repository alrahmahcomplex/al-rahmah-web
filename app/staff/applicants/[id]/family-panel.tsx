"use client"

import Link from "next/link"
import { useState } from "react"

import { Button, StatusChip, Table, Tag } from "@/components/kit"
import { isClosed, type LeadFamily, type LeadFamilyChild } from "@/lib/services/leads"

import { childHref, relationshipLabel } from "../../check-in/family"
import { confirmMatch, rejectMatch, separateLead } from "./family-actions"
import { Refusal, Saved, useCorrection } from "./lead-editors"

type Step = "confirm" | "reject" | "separate"

// The Family section's contents. A change here reaches other children's
// leads too, so each one first names the children it reaches, and goes ahead
// only once staff say so.
export function FamilyPanel({
  leadId,
  studentName,
  family,
  canEdit,
}: {
  leadId: string
  studentName: string
  family: LeadFamily
  canEdit: boolean
}) {
  const [step, setStep] = useState<Step | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const others = family.children.filter((child) => child.id !== leadId)
  // The children on this lead's contact, the lead among them: who a confirm
  // or reject reaches.
  const onContact = family.children.filter((child) => child.onLeadContact)
  const sharedWith = onContact.filter((child) => child.id !== leadId)
  const match = family.pendingMatch
  const canSettle = canEdit && match !== null && !onContact.some(isClosed)
  const canSeparate = canEdit && sharedWith.length > 0

  function open(next: Step) {
    setSaved(null)
    setStep(next)
  }

  function done(message: string | null) {
    setStep(null)
    setSaved(message)
  }

  return (
    <div className="flex flex-col gap-4">
      {match && (
        <div className="lr-box lr-wait">
          <p className="lr-text lr-strong">Unconfirmed Family match</p>
          <p className="lr-text">
            The Admission form matched this parent&apos;s phone to{" "}
            <span className="font-semibold">{match.fullName}</span> (
            {relationshipLabel(match.relationship, match.relationshipDescription)}, {match.phone}), who is already on
            file. Check with the family that they are the same person.
          </p>
          {step === "confirm" && (
            <SettleStep
              ask={`Confirming moves ${onContact.length === 1 ? "this child" : `these ${onContact.length} children`} into ${match.fullName}'s Family:`}
              reaches={onContact}
              action="Confirm"
              pending="Confirming…"
              run={() => confirmMatch(leadId, onContact.map((child) => child.id))}
              onDone={done}
              saved={
                onContact.length === 1
                  ? "Match confirmed. The child is now in the Family."
                  : `Match confirmed. ${onContact.length} children are now in the Family.`
              }
            />
          )}
          {step === "reject" && (
            <SettleStep
              ask={`Rejecting clears the match for ${onContact.length === 1 ? "this child" : `these ${onContact.length} children`}, and their Returning family badge unless they re-applied:`}
              reaches={onContact}
              action="Reject"
              pending="Rejecting…"
              run={() => rejectMatch(leadId, onContact.map((child) => child.id))}
              onDone={done}
              saved="Match rejected. The children are no longer linked to that Family."
            />
          )}
          {canSettle && step === null && (
            <div className="lr-acts">
              <Button variant="ghost" size="small" onClick={() => open("confirm")}>
                Confirm match
              </Button>
              <Button variant="ghost" size="small" onClick={() => open("reject")}>
                Reject match
              </Button>
            </div>
          )}
        </div>
      )}

      {others.length === 0 ? (
        <p className="lr-quiet">No other children are in this Family.</p>
      ) : (
        <FamilyTable rows={others} />
      )}

      {step === "separate" && (
        <div className="lr-box">
          <SettleStep
            ask={`${studentName} will get a parent or guardian contact of their own, copied from the shared one. Changes to it will no longer reach:`}
            note="The Returning family badge goes, unless the child re-applied."
            reaches={sharedWith}
            action="Separate"
            pending="Separating…"
            run={() => separateLead(leadId)}
            onDone={done}
            saved="Separated from the Family. This applicant now has a parent or guardian contact of their own."
          />
        </div>
      )}
      {canSeparate && step === null && (
        <div>
          <Button variant="ghost" size="small" onClick={() => open("separate")}>
            Separate from this Family
          </Button>
        </div>
      )}
      <Saved message={saved} />
    </div>
  )
}

// Names the children a change reaches and asks staff to go ahead.
function SettleStep({
  ask,
  note,
  reaches,
  action,
  pending: pendingLabel,
  run,
  onDone,
  saved,
}: {
  ask: string
  note?: string
  reaches: LeadFamilyChild[]
  action: string
  pending: string
  run: () => ReturnType<typeof confirmMatch>
  onDone: (saved: string | null) => void
  saved: string
}) {
  const { refusal, pending, save } = useCorrection(() => onDone(saved))

  return (
    <form
      aria-label={action}
      className="lr-form"
      onSubmit={(event) => {
        event.preventDefault()
        save(run)
      }}
    >
      <Refusal refusal={refusal} />
      <div className="lr-text">
        <p>{ask}</p>
        <ul className="lr-bullets">
          {reaches.map((child) => (
            <li key={child.id}>
              {child.studentName} <span className="lr-num">{child.admissionNumber}</span>
            </li>
          ))}
        </ul>
        {note && <p className="lr-quiet mt-2">{note}</p>}
      </div>
      <div className="lr-acts">
        <Button type="submit" size="small" pending={pending}>
          {pending ? pendingLabel : action}
        </Button>
        <Button variant="ghost" size="small" onClick={() => onDone(null)} aria-disabled={pending || undefined}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function FamilyTable({ rows }: { rows: LeadFamilyChild[] }) {
  return (
    <Table
      label="Children in this Family"
      rows={rows}
      rowKey={(child) => child.id}
      columns={[
        { header: "Admission Number", cell: (child) => <span className="whitespace-nowrap">{child.admissionNumber}</span> },
        {
          header: "Student",
          cell: (child) => (
            <Link href={childHref(child)} className="lr-link">
              {child.studentName}
            </Link>
          ),
        },
        { header: "Class", cell: (child) => <span className="whitespace-nowrap">{child.className}</span> },
        { header: "Year", cell: (child) => child.enrollmentYear },
        {
          header: "Status",
          cell: (child) => (
            <div className="flex flex-wrap gap-1">
              <StatusChip status={child.status} />
              {child.closure && <StatusChip status={child.closure} />}
              {child.unconfirmed && <Tag tone="line">Unconfirmed</Tag>}
            </div>
          ),
        },
      ]}
    />
  )
}
