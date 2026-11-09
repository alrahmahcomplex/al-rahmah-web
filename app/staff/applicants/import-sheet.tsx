"use client"

import { ChevronRightIcon, UploadIcon } from "lucide-react"
import { AnimatePresence, m } from "motion/react"
import { useRouter } from "next/navigation"
import { Fragment, useRef, useState, useTransition } from "react"

import { LogoLoader } from "@/components/brand/logo-loader"
import { PendingButton } from "@/components/staff/pending-button"
import { SheetForm } from "@/components/staff/sheet-form"
import { SuccessMark } from "@/components/staff/success-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IMPORT_LIMITS, importFileMessage } from "@/lib/import"
import {
  STUDENT_IMPORT_TEMPLATE,
  confirmationOf,
  refusedStudentRowsCsv,
  studentImportSummary,
  withChanges,
  type StudentImportRow,
} from "@/lib/student-import"
import { cn } from "@/lib/utils"

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

// Steps slide a little and fade, 180 ms, exponential ease-out.
const STEP_MOTION = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
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
      <Button type="button" variant="outline" onClick={() => openChange(true)}>
        <UploadIcon aria-hidden="true" />
        Import
      </Button>
      <SheetForm
        open={open}
        onOpenChange={openChange}
        wide
        title="Import applicants"
        description="Upload a CSV, review every row, then create the applicants."
        meta={<Steps current={STEP_INDEX[step.name]} />}
        cancel={step.name === "done" ? false : "Cancel"}
        footerStart={
          step.name === "review" && skippedInFile > 0 ? (
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-slate-900 underline"
              onClick={() => download(skippedFileName(step.fileName), refusedStudentRowsCsv(step.rows))}
            >
              {skippedRowsLabel(skippedInFile)}
            </Button>
          ) : undefined
        }
        footer={
          step.name === "review" && summary ? (
            <PendingButton
              type="button"
              variant="orange"
              pending={pending}
              pendingLabel="Creating…"
              disabled={toCreate(summary) === 0}
              onClick={() => confirm(step)}
            >
              {toCreate(summary) === 0 ? "Nothing to import" : createLabel(summary)}
            </PendingButton>
          ) : step.name === "done" ? (
            <Button type="button" onClick={() => showInList(step.batchId)}>
              Show them in the list
            </Button>
          ) : undefined
        }
      >
        {message && (
          <Alert variant="destructive">
            {step.name === "upload" && message !== CHECK_LOST && <AlertTitle>This file can&apos;t be imported</AlertTitle>}
            <AlertDescription>
              <p>{message.en}</p>
              {message.sw && <p lang="sw">{message.sw}</p>}
            </AlertDescription>
          </Alert>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={step.name === "review" ? `review-${step.round}` : step.name} className="flex flex-col gap-5" {...STEP_MOTION}>
            {step.name === "upload" && <Upload checking={checking} onFile={check} />}
            {step.name === "review" && summary && <Review review={step} summary={summary} />}
            {step.name === "done" && <Done done={step} />}
          </m.div>
        </AnimatePresence>
      </SheetForm>
    </>
  )
}

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-400">
      {STEPS.map((label, index) => (
        <Fragment key={label}>
          {index > 0 && <li aria-hidden="true" className="h-px w-4 bg-slate-300" />}
          <li aria-current={index === current ? "step" : undefined} className={cn(index <= current && "text-slate-900")}>
            {label}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

function Upload({ checking, onFile }: { checking: string | null; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function take(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
    // The same file can be chosen again after a fix.
    if (input.current) input.current.value = ""
  }

  return (
    <>
      <div
        data-dragging={dragging || undefined}
        onDragOver={(event) => {
          if (checking) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!checking) take(event.dataTransfer.files)
        }}
        className="flex flex-col items-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-slate-300 px-5 py-9 text-center text-sm text-muted-foreground transition-colors data-dragging:border-blue-600 data-dragging:bg-blue-50"
      >
        {checking ? (
          <div role="status" className="flex flex-col items-center gap-2.5">
            <LogoLoader size={44} />
            <p className="font-medium wrap-anywhere text-slate-900">Checking {checking}…</p>
          </div>
        ) : (
          <>
            <UploadIcon aria-hidden="true" className="size-7 text-slate-400" strokeWidth={1.75} />
            <p className="font-medium text-slate-900">Drop the CSV here or choose a file</p>
            <p className="text-xs">Up to 1,000 rows. Nothing is saved until you confirm.</p>
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>
              Choose file
            </Button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => take(event.target.files)}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Start from the template so the columns match.{" "}
        <button
          type="button"
          className="font-medium text-slate-900 underline underline-offset-4"
          onClick={() => download("students-import-template.csv", STUDENT_IMPORT_TEMPLATE)}
        >
          Download template
        </button>
      </p>

      <Collapsible className="rounded-lg ring-1 ring-foreground/10">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-slate-900">
          Columns in the template
          <ChevronRightIcon aria-hidden="true" className="size-4 text-slate-400 transition-transform group-aria-expanded:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-4 font-medium">Column</th>
                    <th scope="col" className="py-1.5 font-medium">From the workbook</th>
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATE_COLUMNS.map(([column, workbook]) => (
                    <tr key={column} className="border-t">
                      <td className="py-1.5 pr-4 text-slate-900">{column}</td>
                      <td className="py-1.5 text-slate-700">{workbook}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">Not imported: interview payment, result, score, comments and follow-ups.</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] w-fit shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap", className)}>
      {children}
    </span>
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
      <div className="flex flex-col gap-2.5">
        <p className="text-sm wrap-anywhere">
          <span className="font-medium text-slate-900">{review.fileName}</span>{" "}
          <span className="text-muted-foreground">· {rowsChecked(summary.total)}</span>
        </p>
        <div aria-label="Summary" className="flex flex-wrap gap-2">
          {summaryChips(summary).map((chip) => (
            <Chip key={chip.class} className={CLASS_TONES[chip.class]}>
              {chip.label}
            </Chip>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Only &ldquo;to create&rdquo; and &ldquo;joins a family&rdquo; rows are saved. Rows already present are skipped, since they are
          on file. Flagged and refused rows are skipped and written to a file you can fix and upload again.
        </p>
      </div>

      {review.changedCount > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>{changedTitle(review.changedCount)}</AlertTitle>
          <AlertDescription>The changed rows are marked. Check them, then create again.</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table aria-label="Rows checked" className="w-full min-w-[36rem] text-left text-[13px]">
          <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Row</th>
              <th scope="col" className="px-3 py-2 font-medium">Student</th>
              <th scope="col" className="px-3 py-2 font-medium">Class</th>
              <th scope="col" className="px-3 py-2 font-medium">Parent phone</th>
              <th scope="col" className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {review.rows.map((row) => (
              <ReviewRow key={row.sheetRow} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ReviewRow({ row }: { row: StudentImportRow }) {
  const { normalized: values, original } = row
  const className = values.className ? `${values.className}${values.preFormOne ? " · Pre-Form One" : ""}` : original.className
  return (
    <tr className={cn("border-b align-top last:border-b-0", row.changed && "bg-amber-50")}>
      <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.sheetRow}</td>
      <td className="px-3 py-2 font-medium wrap-anywhere text-slate-900">{values.studentName ?? original.studentName}</td>
      <td className="px-3 py-2 whitespace-nowrap">{className}</td>
      <td className="px-3 py-2 font-mono whitespace-nowrap">{values.phone ?? original.phone}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className={CLASS_TONES[row.class]}>{CLASS_LABELS[row.class]}</Chip>
          {row.changed && <Badge className="bg-amber-500 text-white">Changed since you checked</Badge>}
        </div>
        {row.reason && <span className="mt-0.5 block text-[12.5px] wrap-anywhere text-muted-foreground">{row.reason}</span>}
        {row.notes.map((note) => (
          <span key={note} className="mt-0.5 block text-[12.5px] wrap-anywhere text-muted-foreground">
            {note}
          </span>
        ))}
      </td>
    </tr>
  )
}

function Done({ done }: { done: Extract<Step, { name: "done" }> }) {
  return (
    <>
      <SuccessMark
        title={doneTitle(done)}
        body={<>Each new applicant has an Admission Number and a history line &ldquo;Created by the workbook import ({done.fileName})&rdquo;.</>}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Imported by</dt>
        <dd className="font-medium text-slate-900">{done.importedBy}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd className="font-medium text-slate-900">
          <time dateTime={done.importedAt}>{WHEN.format(new Date(done.importedAt))}</time>
        </dd>
        <dt className="text-muted-foreground">Recorded</dt>
        <dd className="font-medium text-slate-900">Audit history, one line</dd>
      </dl>
    </>
  )
}
