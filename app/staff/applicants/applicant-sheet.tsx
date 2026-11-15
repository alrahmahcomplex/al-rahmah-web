"use client"

import { ButtonLink, KeyValueList, LoadingState, Note, Section, Sheet, StatusChip } from "@/components/kit"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

import { SeatPriorityTag } from "./[id]/seat-priority-tag"
import type { ApplicantSheetAnswer, ApplicantSheetFee } from "./sheet-view"

// The row the sheet opened from: what the list already knows, shown while
// the rest loads.
export type SheetApplicant = { id: string; studentName: string; status: LeadStatus; closure: LeadClosure | null }

// The side sheet an Applicants row opens (the owner's shell decision 4,
// 2026-11-11): Student, Custodian, School fee and the next step, with
// "Open full record" in the foot. Kept mounted, so it slides out; focus goes
// back to the row that opened it.
export function ApplicantSheet({
  applicant,
  answer,
  open,
  onOpenChange,
}: {
  applicant: SheetApplicant | null
  // Null while the applicant loads.
  answer: ApplicantSheetAnswer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const view = answer?.status === "ready" ? answer.view : null
  const shown = view ?? applicant
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      placement="side"
      title={shown?.studentName ?? ""}
      chips={
        shown && (
          <>
            <StatusChip status={shown.status} />
            {shown.closure && <StatusChip status={shown.closure} />}
          </>
        )
      }
      closeLabel="Close"
      foot={
        applicant && (
          <ButtonLink href={`/staff/applicants/${applicant.id}`} variant="ghost" size="wide">
            Open full record
          </ButtonLink>
        )
      }
    >
      {answer === null ? (
        <LoadingState label="Opening the record…" />
      ) : answer.status === "not-found" ? (
        <Note tone="bad" role="alert">
          This application can&apos;t be found. It may have been removed.
        </Note>
      ) : answer.status === "failed" ? (
        <Note tone="bad" role="alert">
          This application could not be loaded. Try again in a moment.
        </Note>
      ) : (
        <>
          <Section title="Student">
            <KeyValueList items={answer.view.student.map(([key, value]) => ({ key, value, numeric: key === "Admission Number" }))} />
          </Section>
          <Section title="Custodian">
            <KeyValueList items={answer.view.custodian.map(([key, value]) => ({ key, value }))} />
          </Section>
          {answer.view.fee && <FeeSection fee={answer.view.fee} />}
          {answer.view.nextStep &&
            (answer.view.nextStep.state === "ready" ? (
              <Note>Next step: {answer.view.nextStep.title}.</Note>
            ) : (
              <Note tone="bad" role="alert">
                The next step could not be worked out. Try again in a moment.
              </Note>
            ))}
        </>
      )}
    </Sheet>
  )
}

// The record's School fee summary: the same four rows as its Overview card.
function FeeSection({ fee }: { fee: ApplicantSheetFee }) {
  return (
    <Section title="School fee">
      {fee.state === "failed" ? (
        <Note tone="bad" role="alert">
          The School fee could not be loaded. Try again in a moment.
        </Note>
      ) : fee.state === "no-schedule" ? (
        <p className="ap-quiet">No fee schedule for {fee.year} yet.</p>
      ) : (
        <>
          <KeyValueList
            items={[
              { key: "Annual fee", value: fee.annualFee, numeric: true },
              { key: "Paid", value: fee.paid, numeric: true },
              { key: "Balance", value: fee.balance, numeric: true },
              {
                key: "Seat priority",
                value: fee.priority ? <SeatPriorityTag priority={fee.priority} /> : "none yet",
                reason: fee.priority && fee.priorityReachedOn ? `since ${fee.priorityReachedOn}` : undefined,
              },
            ]}
          />
          {fee.recordPaymentHref && (
            <ButtonLink href={fee.recordPaymentHref} variant="ghost" size="small">
              Record payment
            </ButtonLink>
          )}
        </>
      )}
    </Section>
  )
}
