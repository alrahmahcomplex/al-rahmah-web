"use client"

import { ButtonLink, KeyValueList, LoadingState, Note, Section, Sheet, StatusChip } from "@/components/kit"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

import { FeeEditNeededTag, SiblingFeeControls } from "./[id]/fee-edit"
import { FatherNameRow, PreviousSchoolRow } from "./[id]/father-school"
import { SeatPriorityTag } from "./[id]/seat-priority-tag"
import { SiblingGroupCard } from "./[id]/sibling-group"
import type { SiblingMemberView } from "@/lib/sibling-group-view"
import type { SiblingFeeFacts } from "./[id]/sibling-read"
import type { ApplicantSheetAnswer, ApplicantSheetFee } from "./sheet-view"

// The row the sheet opened from: what the list already knows, shown while
// the rest loads.
export type SheetApplicant = { id: string; studentName: string; status: LeadStatus; closure: LeadClosure | null }

// The side sheet an Applicants row opens (the owner's shell decision 4,
// 2026-11-11): Student with the father's name and previous school, Custodian,
// the Sibling group (#310), School fee and the next step, with
// "Open full record" in the foot. Kept mounted, so it slides out; focus goes
// back to the row that opened it.
export function ApplicantSheet({
  applicant,
  answer,
  open,
  onOpenChange,
  onChanged,
  onOpenMember,
}: {
  applicant: SheetApplicant | null
  // Null while the applicant loads.
  answer: ApplicantSheetAnswer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  // Reads the applicant again after a change made in the sheet.
  onChanged: () => void
  // Opens a sibling in the sheet.
  onOpenMember: (member: SiblingMemberView) => void
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
          <>
            {view?.id === applicant.id && view.checkInHref && (
              <ButtonLink href={view.checkInHref} size="wide" chevron>
                Check in this family
              </ButtonLink>
            )}
            <ButtonLink href={`/staff/applicants/${applicant.id}`} variant="ghost" size="wide">
              Open full record
            </ButtonLink>
          </>
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
            {answer.view.fatherAndSchool ? (
              <div className="ap-rows">
                <FatherNameRow
                  key={"f-" + answer.view.id}
                  leadId={answer.view.id}
                  studentName={answer.view.studentName}
                  father={answer.view.fatherAndSchool.father}
                  enrolled={answer.view.status === "Enrolled"}
                  compareWith={answer.view.sibling?.compareWith ?? null}
                  canEdit={answer.view.canEdit}
                  onChanged={onChanged}
                />
                <PreviousSchoolRow
                  key={"s-" + answer.view.id}
                  leadId={answer.view.id}
                  className={answer.view.className}
                  school={answer.view.fatherAndSchool.previousSchool}
                  canEdit={answer.view.canEdit}
                  onChanged={onChanged}
                />
              </div>
            ) : (
              <Note tone="bad" role="alert">
                The father’s name and previous school could not be loaded. Try again in a moment.
              </Note>
            )}
          </Section>
          <Section title="Custodian">
            <KeyValueList items={answer.view.custodian.map(([key, value]) => ({ key, value }))} />
          </Section>
          {answer.view.sibling ? (
            <SiblingGroupCard
              key={answer.view.id}
              view={answer.view.sibling}
              open={answer.view.open}
              inSheet
              onChanged={onChanged}
              onOpenMember={onOpenMember}
            />
          ) : (
            <Section title="Sibling group">
              <Note tone="bad" role="alert">
                The sibling group could not be loaded. Try again in a moment.
              </Note>
            </Section>
          )}
          {answer.view.fee && (
            <FeeSection leadId={answer.view.id} fee={answer.view.fee} sibling={answer.view.sibling?.fee ?? null} onChanged={onChanged} />
          )}
          {answer.view.checkInHref ? (
            <Note tone="wait" icon="info">
              Sent from the Admission form. Check-in fills in the missing answers.
            </Note>
          ) : (
            answer.view.nextStep &&
            (answer.view.nextStep.state === "ready" ? (
              <Note>Next step: {answer.view.nextStep.title}.</Note>
            ) : (
              <Note tone="bad" role="alert">
                The next step could not be worked out. Try again in a moment.
              </Note>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}

// The record's School fee summary: the same four rows as its Overview card,
// with "Granted: fee edit needed", and Edit fee and "Leave the fee as it is"
// beside Record payment for staff who may record payments (#311).
function FeeSection({
  leadId,
  fee,
  sibling,
  onChanged,
}: {
  leadId: string
  fee: ApplicantSheetFee
  sibling: SiblingFeeFacts | null
  onChanged: () => void
}) {
  return (
    <Section title="School fee">
      {sibling && <FeeEditNeededTag fee={sibling} />}
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
              { key: "Annual fee", value: fee.annualFee, numeric: true, reason: fee.why },
              { key: "Paid", value: fee.paid, numeric: true },
              { key: "Balance", value: fee.balance, numeric: true },
              {
                key: "Seat priority",
                value: fee.priority ? <SeatPriorityTag priority={fee.priority} /> : "none yet",
                reason: fee.priority && fee.priorityReachedOn ? `since ${fee.priorityReachedOn}` : undefined,
              },
            ]}
          />
          {sibling ? (
            <SiblingFeeControls key={leadId} leadId={leadId} fee={sibling} recordHref={fee.recordPaymentHref} onChanged={onChanged} />
          ) : (
            fee.recordPaymentHref && (
              <ButtonLink href={fee.recordPaymentHref} variant="ghost" size="small">
                Record payment
              </ButtonLink>
            )
          )}
        </>
      )}
    </Section>
  )
}
