"use client"

import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AGENT_IMPORT_CLASSES,
  AGENT_IMPORT_COLUMNS,
  AGENT_IMPORT_TEMPLATE,
  agentImportSummary,
  confirmationOf,
  confirmLabel,
  refusedAgentRowsCsv,
  withChanges,
  type AgentImportClass,
  type AgentImportKey,
  type AgentImportRow,
} from "@/lib/agent-import"
import { IMPORT_LIMITS, importFileMessage } from "@/lib/import"
import { cn } from "@/lib/utils"

import { checkAgentImportUpload, confirmAgentImportRows } from "./actions"
import { CHECK_LOST, CONFIRM_LOST, type ImportMessage } from "./messages"

const CLASS_LABELS: Record<AgentImportClass, string> = {
  create: "To create",
  present: "Already present",
  "email-to-add": "Email to add",
  "email-differs": "Email differs",
  "mobile-differs": "Mobile differs",
  flagged: "Flagged",
  refused: "Refused",
}

const CLASS_STYLES: Record<AgentImportClass, string> = {
  create: "bg-emerald-50 text-emerald-800",
  present: "bg-slate-100 text-slate-700",
  "email-to-add": "bg-blue-50 text-blue-800",
  "email-differs": "bg-amber-50 text-amber-900",
  "mobile-differs": "bg-amber-50 text-amber-900",
  flagged: "bg-orange-100 text-orange-900",
  refused: "bg-red-50 text-red-800",
}

const VALUE_KEYS: { key: AgentImportKey; label: string; normalized: "code" | "fullName" | "mobile" | "whatsapp" | "email" }[] = [
  { key: "code", label: "Code", normalized: "code" },
  { key: "fullName", label: "Name", normalized: "fullName" },
  { key: "mobile", label: "Mobile", normalized: "mobile" },
  { key: "whatsapp", label: "WhatsApp", normalized: "whatsapp" },
  { key: "email", label: "Email", normalized: "email" },
]

type Step =
  | { name: "upload" }
  // round counts the confirms that found changed rows.
  | { name: "check"; fileName: string; rows: AgentImportRow[]; changedCount: number; round: number }
  | { name: "done"; fileName: string; rows: AgentImportRow[]; batchId: string; created: number; emailsAdded: number; skipped: number }

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

function refusedFileName(fileName: string) {
  return `${fileName.replace(/\.csv$/i, "")}-refused-rows.csv`
}

function Message({ message, title }: { message: ImportMessage; title?: string }) {
  return (
    <Alert variant="destructive">
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        <p>{message.en}</p>
        {message.sw && <p lang="sw">{message.sw}</p>}
      </AlertDescription>
    </Alert>
  )
}

// The Manager's import: download the template, upload the filled file, check
// every row, confirm, then download the refused rows to fix.
export function AgentImport() {
  const [step, setStep] = useState<Step>({ name: "upload" })
  const [message, setMessage] = useState<ImportMessage | null>(null)
  const [pending, startTransition] = useTransition()

  function upload(form: FormData) {
    const file = form.get("file")
    // Refused here first, so a big file is never sent.
    if (file instanceof File && file.size > IMPORT_LIMITS.maxBytes) {
      setMessage(importFileMessage({ kind: "too-large", maxBytes: IMPORT_LIMITS.maxBytes }))
      return
    }
    setMessage(null)
    startTransition(async () => {
      let answer
      try {
        answer = await checkAgentImportUpload(form)
      } catch {
        // The check saves nothing, so trying again is safe.
        answer = { status: "refused" as const, message: CHECK_LOST }
      }
      if (answer.status === "refused") setMessage(answer.message)
      else setStep({ name: "check", fileName: answer.fileName, rows: answer.rows, changedCount: 0, round: 0 })
    })
  }

  function confirm(check: Extract<Step, { name: "check" }>) {
    setMessage(null)
    startTransition(async () => {
      let answer
      try {
        answer = await confirmAgentImportRows(confirmationOf(check))
      } catch {
        // The answer was lost, perhaps after the import saved.
        answer = { status: "refused" as const, message: CONFIRM_LOST }
      }
      if (answer.status === "refused") setMessage(answer.message)
      else if (answer.status === "changed") {
        setStep({ ...check, rows: withChanges(check.rows, answer.changed), changedCount: answer.changed.length, round: check.round + 1 })
      } else setStep({ name: "done", fileName: check.fileName, rows: check.rows, ...answer })
    })
  }

  function startOver() {
    setMessage(null)
    setStep({ name: "upload" })
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <Message message={message} title={step.name === "upload" && message !== CHECK_LOST ? "This file can't be imported" : undefined} />
      )}
      {step.name === "upload" && <Upload onUpload={upload} pending={pending} />}
      {step.name === "check" && <CheckScreen key={step.round} check={step} pending={pending} onConfirm={() => confirm(step)} onStartOver={startOver} />}
      {step.name === "done" && <Result result={step} onStartOver={startOver} />}
    </div>
  )
}

function Upload({ onUpload, pending }: { onUpload: (form: FormData) => void; pending: boolean }) {
  const inputId = useId()
  return (
    <>
      <section aria-labelledby="template-heading" className="flex max-w-2xl flex-col gap-3">
        <h2 id="template-heading" className="staff-section-heading">
          1. Fill in the template
        </h2>
        <div>
          <Button type="button" variant="outline" onClick={() => download("agents-template.csv", AGENT_IMPORT_TEMPLATE)}>
            Download the template
          </Button>
        </div>
        <p className="text-sm text-slate-700">
          Its columns are {AGENT_IMPORT_COLUMNS.map((column) => column.header).join(", ")}. One agent per row. Keep each agent&rsquo;s
          code exactly as they use it. Mobile is required; WhatsApp and Email may be left empty.
        </p>
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <p className="font-medium">In Google Sheets</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Open the template: File, then Import, then Upload.</li>
            <li>
              Select every column, then choose Format, then Number, then <strong>Plain text</strong>, before you paste or type. Otherwise
              Sheets drops a mobile&rsquo;s leading 0 or turns it into a number like 7.12E+08.
            </li>
            <li>Paste or type the agents under the first row, leaving the first row as it is.</li>
            <li>
              Choose File, then Download, then <strong>Comma-separated values (.csv)</strong>.
            </li>
          </ol>
        </div>
      </section>

      <section aria-labelledby="upload-heading" className="flex max-w-2xl flex-col gap-3">
        <h2 id="upload-heading" className="staff-section-heading">
          2. Upload the file
        </h2>
        <form action={onUpload} className="flex flex-col gap-2">
          <Label htmlFor={inputId}>CSV file</Label>
          <Input id={inputId} name="file" type="file" accept=".csv,text/csv" required aria-describedby={`${inputId}-hint`} />
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            Up to 256 KB and 1,000 rows. Nothing is saved until you confirm.
          </p>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Checking…" : "Check file"}
            </Button>
          </div>
        </form>
      </section>
    </>
  )
}

function CheckScreen({
  check,
  pending,
  onConfirm,
  onStartOver,
}: {
  check: Extract<Step, { name: "check" }>
  pending: boolean
  onConfirm: () => void
  onStartOver: () => void
}) {
  // Keyed on each confirm's answer, so changed rows show first.
  const [filter, setFilter] = useState<AgentImportClass | "all" | "changed">(check.changedCount > 0 ? "changed" : "all")
  const summary = agentImportSummary(check.rows)
  const canConfirm = summary.create + summary["email-to-add"] > 0
  const refusedCount = summary.refused + summary.flagged
  const shown = check.rows.filter((row) => (filter === "all" ? true : filter === "changed" ? row.changed : row.class === filter))

  const filters: { value: typeof filter; label: string; count: number }[] = [
    { value: "all", label: "All rows", count: summary.total },
    ...(check.changedCount > 0 ? [{ value: "changed" as const, label: "Changed", count: check.changedCount }] : []),
    ...AGENT_IMPORT_CLASSES.map((value) => ({ value, label: CLASS_LABELS[value], count: summary[value] })).filter((f) => f.count > 0),
  ]

  return (
    <section aria-labelledby="check-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="check-heading" className="staff-section-heading wrap-anywhere">
          Check {check.fileName}
        </h2>
        <p className="text-sm text-slate-700">
          Nothing is saved yet. Each row shows its row number in the sheet, and what was uploaded beside what will be saved.
        </p>
      </div>

      {check.changedCount > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>
            {check.changedCount === 1 ? "1 row changed" : `${check.changedCount} rows changed`} since you checked, so nothing was saved
          </AlertTitle>
          <AlertDescription>The changed rows are marked. Check them, then confirm again.</AlertDescription>
        </Alert>
      )}

      <div role="group" aria-label="Show rows" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label} <span className="tabular-nums">{f.count.toLocaleString("en-US")}</span>
          </Button>
        ))}
      </div>

      <ol aria-label="Rows" className="flex flex-col gap-2">
        {shown.map((row) => (
          <RowCard key={row.sheetRow} row={row} />
        ))}
      </ol>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center">
        <Button type="button" onClick={onConfirm} disabled={pending || !canConfirm}>
          {pending ? "Saving…" : canConfirm ? confirmLabel(summary) : "Nothing to import"}
        </Button>
        {refusedCount > 0 && (
          <Button type="button" variant="outline" onClick={() => download(refusedFileName(check.fileName), refusedAgentRowsCsv(check.rows))}>
            Download refused rows ({refusedCount.toLocaleString("en-US")})
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onStartOver} disabled={pending}>
          Upload a different file
        </Button>
      </div>
    </section>
  )
}

function RowCard({ row }: { row: AgentImportRow }) {
  return (
    <li
      aria-label={`Row ${row.sheetRow}`}
      className={cn("rounded-lg px-3 py-2 text-sm ring-1 ring-foreground/10", row.changed && "bg-amber-50 ring-2 ring-amber-400")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">Row {row.sheetRow}</span>
        <Badge variant="secondary" className={CLASS_STYLES[row.class]}>
          {CLASS_LABELS[row.class]}
        </Badge>
        {row.changed && <Badge className="bg-amber-500 text-white">Changed since you checked</Badge>}
      </div>
      {row.reason && <p className="mt-1 wrap-anywhere text-slate-800">{row.reason}</p>}
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {VALUE_KEYS.map(({ key, label, normalized }) => {
          const original = row.original[key]
          const saved = row.normalized[normalized]
          if (original.trim() === "" && saved === null) return null
          return (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">
                {/* Spaces kept, so extra ones show. */}
                <span className="font-mono whitespace-pre-wrap">{original}</span>
                {saved !== null && saved !== original && (
                  <>
                    {" "}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">saved as</span> <span className="font-mono font-medium">{saved}</span>
                  </>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      {row.agent && (
        <p className="mt-1 text-xs wrap-anywhere text-muted-foreground">
          Stored: {row.agent.fullName}, {row.agent.code}, {row.agent.phone}
          {row.agent.email ? `, ${row.agent.email}` : ", no email"}
        </p>
      )}
    </li>
  )
}

function Result({ result, onStartOver }: { result: Extract<Step, { name: "done" }>; onStartOver: () => void }) {
  const summary = agentImportSummary(result.rows)
  const refusedCount = summary.refused + summary.flagged
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
  return (
    <section aria-labelledby="result-heading" className="flex max-w-2xl flex-col gap-4">
      <h2 id="result-heading" className="staff-section-heading wrap-anywhere">
        {result.fileName} is imported
      </h2>
      <ul className="list-disc pl-5 text-sm text-slate-800">
        <li>{plural(result.created, "agent", "agents")} created, Approved.</li>
        {result.emailsAdded > 0 && <li>{plural(result.emailsAdded, "email", "emails")} added to agents who had none.</li>}
        <li>{plural(result.skipped, "row", "rows")} skipped.</li>
      </ul>
      <p className="text-sm text-slate-700">No email was sent. Imported emails count as confirmed by you.</p>
      {refusedCount > 0 && (
        <p className="text-sm text-slate-700">
          {plural(refusedCount, "row was", "rows were")} refused. Download them, fix each one using its reason, and upload that file.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link href={`/staff/agents?status=all&import=${result.batchId}`} className={buttonVariants()}>
          See the agents this import created
        </Link>
        {refusedCount > 0 && (
          <Button type="button" variant="outline" onClick={() => download(refusedFileName(result.fileName), refusedAgentRowsCsv(result.rows))}>
            Download refused rows ({refusedCount.toLocaleString("en-US")})
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onStartOver}>
          Import another file
        </Button>
      </div>
    </section>
  )
}
