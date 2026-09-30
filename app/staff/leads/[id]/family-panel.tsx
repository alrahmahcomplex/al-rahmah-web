"use client"

import Link from "next/link"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Unconfirmed Family match</p>
          <p className="text-sm text-slate-700">
            The Admission form matched this parent&apos;s phone to{" "}
            <span className="font-medium text-slate-900">{match.fullName}</span> (
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => open("confirm")}>
                Confirm match
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => open("reject")}>
                Reject match
              </Button>
            </div>
          )}
        </div>
      )}

      {others.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other children are in this Family.</p>
      ) : (
        <FamilyTable rows={others} />
      )}

      {step === "separate" && (
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border p-4">
          <SettleStep
            ask={`${studentName} will get a parent or guardian contact of their own, copied from the shared one. Changes to it will no longer reach:`}
            note="The Returning family badge goes, unless the child re-applied."
            reaches={sharedWith}
            action="Separate"
            pending="Separating…"
            run={() => separateLead(leadId)}
            onDone={done}
            saved="Separated from the Family. This lead now has a parent or guardian contact of its own."
          />
        </div>
      )}
      {canSeparate && step === null && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => open("separate")}>
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        save(run)
      }}
    >
      <Refusal refusal={refusal} />
      <div className="text-sm text-slate-900">
        <p>{ask}</p>
        <ul className="mt-1 list-disc pl-5">
          {reaches.map((child) => (
            <li key={child.id}>
              {child.studentName} <span className="font-mono">{child.admissionNumber}</span>
            </li>
          ))}
        </ul>
        {note && <p className="mt-2 text-muted-foreground">{note}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? pendingLabel : action}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onDone(null)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function FamilyTable({ rows }: { rows: LeadFamilyChild[] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <table aria-label="Children in this Family" className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
            <th scope="col" className="px-3 py-2 font-medium">Student</th>
            <th scope="col" className="px-3 py-2 font-medium">Class</th>
            <th scope="col" className="px-3 py-2 font-medium">Year</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => (
            <tr key={child.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono whitespace-nowrap">{child.admissionNumber}</td>
              <td className="px-3 py-2 font-medium text-slate-900">
                <Link href={childHref(child)} className="text-blue-700 underline underline-offset-4">
                  {child.studentName}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{child.className}</td>
              <td className="px-3 py-2">{child.enrollmentYear}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <Badge variant={child.status === "Declined" ? "destructive" : "secondary"}>{child.status}</Badge>
                  {child.closure && <Badge variant="outline">{child.closure}</Badge>}
                  {child.unconfirmed && <Badge variant="outline">Unconfirmed</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
