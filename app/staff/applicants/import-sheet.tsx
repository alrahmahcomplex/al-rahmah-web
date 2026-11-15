"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  Button,
  Disclosure,
  FilePicker,
  FinishedState,
  KeyValueList,
  LoadingState,
  Note,
  Sheet,
  Table,
  Tag,
  TextLink,
} from "@/components/kit"
import { IMPORT_LIMITS, importFileMessage } from "@/lib/import"
import {
  STUDENT_IMPORT_TEMPLATE,
  confirmationOf,
  refusedStudentRowsCsv,
  studentImportSummary,
  withChanges,
  type StudentImportRow,
} from "@/lib/student-import"

import { checkStudentImportUpload, confirmStudentImportRows } from "./import-actions"
import {
  CHECK_LOST,
  CLASS_LABELS,
  CLASS_TONES,
  CONFIRM_LOST,
  changedTitle,
  createLabel,
  doneTitle,
  rowsChecked,
  skippedFileName,
  skippedFileRows,
  skippedRowsLabel,
  summaryChips,
  toCreate,
  type ImportMessage,
} from "./import-messages"
import { leadsHref } from "./search-params"

type Step =
  | { name: "upload" }
  // round counts the confirms that found changed rows.
  | { name: "review"; fileName: string; rows: StudentImportRow[]; changedCount: number; round: number }
  | {
      name: "done"
      fileName: string
      batchId: string
      created: number
      joinedFamily: number
      skipped: number
      importedAt: string
      importedBy: string
    }

const STEPS = ["Upload", "Review", "Done"] as const
const STEP_INDEX: Record<Step["name"], number> = { upload: 0, review: 1, done: 2 }

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Dar_es_Salaam",
})

// What the template's columns hold, against the admissions workbook's own.
const TEMPLATE_COLUMNS: [string, string][] = [
  ["Student name", "STUDENT NAME"],
  ["Class", "CLASS. PRE-FORM ONE becomes FORM 1 with Pre-Form One"],
  ["Enrollment year", "ENROLLMENT YEAR"],
  ["Day or boarding", "New. Day when empty"],
  ["Parent name, relationship, phone", "PARENT/GUARDIAN CONTACTS, RELATIONSHIP"],
  ["Visit date", "DATE"],
  ["Discount code", "CODE. The Marketing Agent or Promo code is found from it"],
  ["Status", "CUSTOMER JOURNEY"],
]

// Saves a CSV built here in the browser; nothing is stored on the server. The
// byte-order mark lets Excel read the names' accents.
function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Import on the Applicants list, for staff with leads.import: upload a CSV
// of the admissions workbook, review every row, create the applicants all or
// nothing, then show them in the list.
export function ImportSheet({ staffName }: { staffName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>({ name: "upload" })
  const [message, setMessage] = useState<ImportMessage | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openChange(next: boolean) {
    setOpen(next)
    // Closing starts over, and so does opening after an import finished. An
    // import in flight keeps its answer for the next open.
    if ((!next && !pending) || (next && step.name === "done")) {
      setStep({ name: "upload" })
      setMessage(null)
    }
  }

  function check(file: File) {
    // Refused here first, so a big file is never sent.
    if (file.size > IMPORT_LIMITS.maxBytes) {
      setMessage(importFileMessage({ kind: "too-large", maxBytes: IMPORT_LIMITS.maxBytes }))
      return
    }
    setMessage(null)
    setChecking(file.name)
    const form = new FormData()
    form.append("file", file)
    startTransition(async () => {
      let answer
      try {
        answer = await checkStudentImportUpload(form)
      } catch {
        // The check saves nothing, so trying again is safe.
        answer = { status: "refused" as const, message: CHECK_LOST }
      }
      setChecking(null)
      if (answer.status === "refused") setMessage(answer.message)
      else setStep({ name: "review", fileName: answer.fileName, rows: answer.rows, changedCount: 0, round: 0 })
    })
  }

  function confirm(review: Extract<Step, { name: "review" }>) {
    setMessage(null)
    startTransition(async () => {
      let answer
      try {
        answer = await confirmStudentImportRows(confirmationOf(review))
      } catch {
        // The answer was lost, perhaps after the import saved.
        answer = { status: "refused" as const, message: CONFIRM_LOST }
      }
      if (answer.status === "refused") setMessage(answer.message)
      else if (answer.status === "changed") {
        setStep({ ...review, rows: withChanges(review.rows, answer.changed), changedCount: answer.changed.length, round: review.round + 1 })
      } else {
        setStep({
          name: "done",
          fileName: review.fileName,
          batchId: answer.batchId,
          created: answer.created,
          joinedFamily: answer.joinedFamily,
          skipped: answer.skipped,
          importedAt: answer.importedAt,
          importedBy: answer.importedBy ?? staffName,
        })
      }
    })
  }

  function showInList(batchId: string) {
    setOpen(false)
    router.push(leadsHref({ page: 1, importBatchId: batchId }))
  }

  const summary = step.name === "review" ? studentImportSummary(step.rows) : null
  const skippedInFile = summary ? skippedFileRows(summary) : 0

  return (
    <>
      <Button variant="ghost" size="small" icon="upload" onClick={() => openChange(true)}>
        Import
      </Button>
      <Sheet
        open={open}
        onOpenChange={openChange}
        placement="side"
        title="Import applicants"
        hint="Upload a CSV, review every row, then create the applicants."
        chips={<Steps current={STEP_INDEX[step.name]} />}
        closeLabel="Close"
        foot={
          step.name === "review" && summary ? (
            <>
              <Button size="wide" pending={pending} disabled={!pending && toCreate(summary) === 0} onClick={() => confirm(step)}>
                {pending ? "Creating…" : toCreate(summary) === 0 ? "Nothing to import" : createLabel(summary)}
              </Button>
              {skippedInFile > 0 && (
                <Button
                  variant="ghost"
                  size="wide"
                  onClick={() => download(skippedFileName(step.fileName), refusedStudentRowsCsv(step.rows))}
                >
                  {skippedRowsLabel(skippedInFile)}
                </Button>
              )}
              <Button variant="ghost" size="wide" onClick={() => openChange(false)}>
                Cancel
              </Button>
            </>
          ) : step.name === "done" ? (
            <Button size="wide" chevron onClick={() => showInList(step.batchId)}>
              Show them in the list
            </Button>
          ) : (
            <Button variant="ghost" size="wide" onClick={() => openChange(false)}>
              Cancel
            </Button>
          )
        }
      >
        <div className="ap-form">
          {message && (
            <Note tone="bad" role="alert">
              <span className="ap-lines">
                {step.name === "upload" && message !== CHECK_LOST && <b>This file can&apos;t be imported</b>}
                <span>{message.en}</span>
                {message.sw && <span lang="sw">{message.sw}</span>}
              </span>
            </Note>
          )}
          {step.name === "upload" && <Upload checking={checking} onFile={check} />}
          {step.name === "review" && summary && <Review key={step.round} review={step} summary={summary} />}
          {step.name === "done" && <Done done={step} />}
        </div>
      </Sheet>
    </>
  )
}

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="ap-steps">
      {STEPS.map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined} className={index < current ? "ap-past" : undefined}>
          {index > 0 && <span aria-hidden="true" className="ap-line" />} {label}
        </li>
      ))}
    </ol>
  )
}

function Upload({ checking, onFile }: { checking: string | null; onFile: (file: File) => void }) {
  // A new picker after each check, so the same file can be chosen again after a fix.
  const [attempt, setAttempt] = useState(0)

  return (
    <>
      {checking ? (
        <LoadingState label={<span className="ap-text">Checking {checking}…</span>} />
      ) : (
        <FilePicker
          key={attempt}
          accept=".csv,text/csv"
          inputLabel="CSV file"
          title="Drop the CSV here or choose a file"
          hint="Up to 1,000 rows. Nothing is saved until you confirm."
          chooseLabel="Choose file"
          onFileChange={(file) => {
            if (!file) return
            setAttempt((n) => n + 1)
            onFile(file)
          }}
        />
      )}

      <p className="ap-small">
        Start from the template so the columns match.{" "}
        <TextLink onClick={() => download("students-import-template.csv", STUDENT_IMPORT_TEMPLATE)}>Download template</TextLink>
      </p>

      <Disclosure variant="boxed" label="Columns in the template">
        <Table
          label="Columns in the template"
          columns={[
            { header: "Column", rowHeader: true, cell: ([column]: [string, string]) => column },
            { header: "From the workbook", cell: ([, workbook]: [string, string]) => workbook },
          ]}
          rows={TEMPLATE_COLUMNS}
          rowKey={([column]) => column}
        />
        <p className="ap-small">Not imported: interview payment, result, score, comments and follow-ups.</p>
      </Disclosure>
    </>
  )
}

function Review({
  review,
  summary,
}: {
  review: Extract<Step, { name: "review" }>
  summary: ReturnType<typeof studentImportSummary>
}) {
  return (
    <>
      <div className="ap-lines">
        <p className="ap-text">
          <span className="ap-strong">{review.fileName}</span> <span className="ap-small">· {rowsChecked(summary.total)}</span>
        </p>
        <div aria-label="Summary" className="ap-chips">
          {summaryChips(summary).map((chip) => (
            <Tag key={chip.class} tone={CLASS_TONES[chip.class]}>
              {chip.label}
            </Tag>
          ))}
        </div>
        <p className="ap-small">
          Only &ldquo;to create&rdquo; and &ldquo;joins a family&rdquo; rows are saved. Rows already present are skipped, since they are
          on file. Flagged and refused rows are skipped and written to a file you can fix and upload again.
        </p>
      </div>

      {review.changedCount > 0 && (
        <Note tone="wait" role="alert">
          <span className="ap-lines">
            <b>{changedTitle(review.changedCount)}</b>
            <span>The changed rows are marked. Check them, then create again.</span>
          </span>
        </Note>
      )}

      <Table
        label="Rows checked"
        columns={[
          { header: "Row", cell: (row: StudentImportRow) => row.sheetRow },
          { header: "Student", rowHeader: true, cell: (row: StudentImportRow) => row.normalized.studentName ?? row.original.studentName },
          { header: "Class", cell: (row: StudentImportRow) => <span className="ap-nowrap">{classOf(row)}</span> },
          { header: "Parent phone", cell: (row: StudentImportRow) => <span className="ap-nowrap">{row.normalized.phone ?? row.original.phone}</span> },
          { header: "Result", cell: (row: StudentImportRow) => <Result row={row} /> },
        ]}
        rows={review.rows}
        rowKey={(row) => String(row.sheetRow)}
      />
    </>
  )
}

function classOf(row: StudentImportRow) {
  const { normalized: values, original } = row
  return values.className ? `${values.className}${values.preFormOne ? " · Pre-Form One" : ""}` : original.className
}

function Result({ row }: { row: StudentImportRow }) {
  return (
    <>
      <span className="ap-chips">
        <Tag tone={CLASS_TONES[row.class]}>{CLASS_LABELS[row.class]}</Tag>
        {row.changed && <Tag tone="wait">Changed since you checked</Tag>}
      </span>
      {row.reason && <span className="ap-reason">{row.reason}</span>}
      {row.notes.map((note) => (
        <span key={note} className="ap-reason">
          {note}
        </span>
      ))}
    </>
  )
}

// The result is a status, so a screen reader announces it when the step opens.
function Done({ done }: { done: Extract<Step, { name: "done" }> }) {
  return (
    <div role="status">
      <FinishedState
        title={doneTitle(done)}
        hint={<>Each new applicant has an Admission Number and a history line &ldquo;Created by the workbook import ({done.fileName})&rdquo;.</>}
      >
        <KeyValueList
          items={[
            { key: "Imported by", value: done.importedBy },
            { key: "When", value: <time dateTime={done.importedAt}>{WHEN.format(new Date(done.importedAt))}</time> },
            { key: "Recorded", value: "Audit history, one line" },
          ]}
        />
      </FinishedState>
    </div>
  )
}
