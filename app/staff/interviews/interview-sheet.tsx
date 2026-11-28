"use client"

import { useEffect, useState, useTransition } from "react"

import { ButtonLink, KeyValueList, Note, Section, Sheet, SkeletonBlock, Tag, type KeyValueItem } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"

import { InterviewFeeControl } from "../applicants/[id]/interview-fee"
import { tzs } from "../applicants/[id]/interview-outcome"
import { InterviewResultEditor } from "../applicants/[id]/interview-result"
import "../applicants/[id]/lead.css"
import type { BoardRow } from "./board"
import { ResultTag } from "./result-tag"
import { loadInterviewSheet, type SheetOutcome } from "./sheet-actions"

/**
 * The interview of a row on the Interviews list, in a side sheet (prototype
 * 1MpUKuX27V6pc1CS1z1URz v5): what the record's Interview tab shows, with
 * Record result and Mark paid for the staff allowed to (owner's choice B).
 * Sending the result stays on the full record, where the message is read
 * first. View full record opens the record on its Interview tab.
 */
export function InterviewSheet({
  row,
  canRecord,
  canMarkFee,
  fullRecordHref,
  onClose,
}: {
  row: BoardRow | null
  canRecord: boolean
  canMarkFee: boolean
  fullRecordHref: (row: BoardRow) => string
  onClose: () => void
}) {
  // The row as it was last shown, so the sheet keeps its content while it closes.
  const [shown, setShown] = useState<BoardRow | null>(row)
  if (row && row !== shown) setShown(row)
  const [outcome, setOutcome] = useState<{ key: string; value: SheetOutcome } | null>(null)
  const [, startLoading] = useTransition()

  // Read again whenever what the list knows of the row changes, as after a save here refreshes the list.
  const key = row ? [row.id, row.result, row.score, row.feeStatus, row.sentOn].join("|") : null
  useEffect(() => {
    if (!row || !key) return
    let live = true
    startLoading(async () => {
      let value: SheetOutcome
      try {
        value = await loadInterviewSheet(row.leadId, row.id)
      } catch {
        value = { ok: false, message: "This interview could not be loaded. Check your connection and try again." }
      }
      if (live) setOutcome({ key, value })
    })
    return () => {
      live = false
    }
    // `key` stands for the row's parts that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = shown
  const loaded = outcome && current && outcome.key.startsWith(`${current.id}|`) ? outcome.value : null

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      placement="side"
      title={current?.studentName ?? ""}
      hint={current ? `${current.admissionNumber} · ${current.className} · ${current.dayOrBoarding}` : undefined}
      chips={
        current && (
          <span className="iv-chips">
            {current.result ? <ResultTag result={current.result} /> : <Tag tone="line">No result yet</Tag>}
            <Tag tone={current.feeStatus === "Paid" ? "ok" : "wait"}>Interview fee {current.feeStatus}</Tag>
            {current.closed && <Tag tone={current.closed.declined ? "bad" : "line"}>{current.closed.text}</Tag>}
          </span>
        )
      }
      closeLabel="Close"
      foot={
        current && (
          <ButtonLink href={fullRecordHref(current)} size="wide">
            View full record
          </ButtonLink>
        )
      }
    >
      {current &&
        (loaded === null ? (
          <div className="iv-sheet-wait" aria-busy="true" aria-label="Loading the interview">
            <SkeletonBlock width="40%" height={20} />
            <SkeletonBlock width="100%" height={120} shape="card" />
            <SkeletonBlock width="70%" height={16} />
          </div>
        ) : !loaded.ok ? (
          <Note tone="bad" role="alert">
            {loaded.message}
          </Note>
        ) : (
          <Details row={current} details={loaded.details} canRecord={canRecord} canMarkFee={canMarkFee} />
        ))}
    </Sheet>
  )
}

function Details({
  row,
  details,
  canRecord,
  canMarkFee,
}: {
  row: BoardRow
  details: Extract<SheetOutcome, { ok: true }>["details"]
  canRecord: boolean
  canMarkFee: boolean
}) {
  const interview = details.interview
  const paid = interview.feeStatus === "Paid"
  // As on the record: only the lead's current interview, and only while the application is open, takes changes.
  const changeable = details.current && row.closed === null

  const items: KeyValueItem[] = [
    { key: "Registered on", value: formatDate(interview.registeredOn), numeric: true },
    { key: "Interview fee", value: interview.feeStatus },
    {
      key: paid ? "Amount paid" : "Amount to pay",
      value: tzs(interview.amount),
      numeric: true,
      reason: [interview.discountApplied && "Includes the Referral code discount.", paid && "Locked when the fee was marked Paid."].filter(Boolean).join(" ") || undefined,
    },
  ]
  if (interview.result === null) items.push({ key: "Result", value: "No result yet" })
  else {
    items.push(
      { key: "Interview date", value: interview.interviewDate ? formatDate(interview.interviewDate) : "", numeric: true },
      { key: "Result", value: <ResultTag result={interview.result} /> },
      { key: "Score", value: `${interview.score}%`, numeric: true },
      { key: "Next action", value: interview.nextAction ?? "" },
    )
    if (interview.result === "Conditional") {
      items.push({
        key: "Agreement",
        value: interview.agreementSignedOn ? `Signed on ${formatDate(interview.agreementSignedOn)}` : "Not signed yet",
        reason: interview.agreementSignedBy ? `marked by ${interview.agreementSignedBy}` : undefined,
      })
    }
  }

  return (
    <>
      {row.closed && (
        <Note tone={row.closed.declined ? "bad" : "info"}>This application is {row.closed.text.toLowerCase()}. It stays on the list, so its S/N is never given again.</Note>
      )}
      <Section title="Interview">
        <div className="iv-sn-big">
          <span className="iv-quiet">Interview S/N</span>
          <b>{interview.serialNumber}</b>
          <span>for {interview.enrollmentYear}</span>
        </div>
        <p className="iv-sn-rule">
          Number {interview.serialNumber} on the {interview.enrollmentYear} interview list. Each year&apos;s list starts again at 1.
        </p>
        <KeyValueList items={items} />
        {changeable && canMarkFee && <InterviewFeeControl key={`fee-${interview.id}`} leadId={row.leadId} interviewId={interview.id} feeStatus={interview.feeStatus} />}
        {changeable && canRecord && (
          <InterviewResultEditor
            key={`result-${interview.id}`}
            leadId={row.leadId}
            interview={{ id: interview.id, registeredOn: interview.registeredOn, interviewDate: interview.interviewDate, result: interview.result, score: interview.score }}
          />
        )}
      </Section>
      {details.release && (
        <Section title="Result release">
          <p className={details.release.sent ? "iv-text" : "iv-quiet iv-text"}>{details.release.text}</p>
        </Section>
      )}
      {!details.current && (
        <Section title="Result release">
          <p className="iv-quiet iv-text">A later interview took this one&apos;s place. Its result is on the full record.</p>
        </Section>
      )}
      {details.others.length > 0 && (
        <Section title={details.others.length === 1 ? "Other interview" : "Other interviews"}>
          <ul className="iv-others">
            {details.others.map((other) => (
              <li key={other.id}>
                S/N {other.serialNumber} for {other.enrollmentYear} · {other.result ? <ResultTag result={other.result} /> : <span className="iv-quiet">No result yet</span>}
                {other.score !== null && ` · ${other.score}%`}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
