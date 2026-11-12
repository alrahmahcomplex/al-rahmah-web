"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button, ButtonLink, Card, FilterPills, FinishedState, Note, Tag, TaskCard, type TagTone } from "@/components/kit"
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

import { FilePicker } from "../form-parts"
import { checkAgentImportUpload, confirmAgentImportRows } from "./actions"
import { CHECK_LOST, CONFIRM_LOST, type ImportMessage } from "./messages"
import "../agents.css"

const CLASS_LABELS: Record<AgentImportClass, string> = {
  create: "To create",
  present: "Already present",
  "email-to-add": "Email to add",
  "email-differs": "Email differs",
  "mobile-differs": "Mobile differs",
  flagged: "Flagged",
  refused: "Refused",
}

const CLASS_TONES: Record<AgentImportClass, TagTone> = {
  create: "ok",
  present: "line",
  "email-to-add": "line",
  "email-differs": "wait",
  "mobile-differs": "wait",
  flagged: "wait",
  refused: "bad",
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
    <Note tone="bad" role="alert">
      <span className="ag-lines">
        {title && <b>{title}</b>}
        <span>{message.en}</span>
        {message.sw && <span lang="sw">{message.sw}</span>}
      </span>
    </Note>
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
    <div className="ag-page">
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
      <Card title="1. Fill in the template">
        <div className="ag-card-body">
          <div>
            <Button variant="ghost" onClick={() => download("agents-template.csv", AGENT_IMPORT_TEMPLATE)}>
              Download the template
            </Button>
          </div>
          <p className="ag-p">
            Its columns are {AGENT_IMPORT_COLUMNS.map((column) => column.header).join(", ")}. One agent per row. Keep each agent&rsquo;s
            code exactly as they use it. Mobile is required; WhatsApp and Email may be left empty.
          </p>
          <Note>
            <span className="ag-lines">
              <b>In Google Sheets</b>
              <ol className="ag-steps">
                <li>Open the template: File, then Import, then Upload.</li>
                <li>
                  Select every column, then choose Format, then Number, then <strong>Plain text</strong>, before you paste or type.
                  Otherwise Sheets drops a mobile&rsquo;s leading 0 or turns it into a number like 7.12E+08.
                </li>
                <li>Paste or type the agents under the first row, leaving the first row as it is.</li>
                <li>
                  Choose File, then Download, then <strong>Comma-separated values (.csv)</strong>.
                </li>
              </ol>
            </span>
          </Note>
        </div>
      </Card>

      <Card title="2. Upload the file">
        <form action={onUpload} className="ag-card-body">
          <FilePicker
            id={inputId}
            name="file"
            accept=".csv,text/csv"
            required
            label="CSV file"
            hint="Up to 256 KB and 1,000 rows. Nothing is saved until you confirm."
          />
          <div>
            <Button type="submit" pending={pending}>
              {pending ? "Checking…" : "Check file"}
            </Button>
          </div>
        </form>
      </Card>
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
    <Card
      title={<span className="ag-wrap">Check {check.fileName}</span>}
      caption="Nothing is saved yet. Each row shows its row number in the sheet, and what was uploaded beside what will be saved."
    >
      <div className="ag-card-body">
        {check.changedCount > 0 && (
          <Note tone="wait" role="alert">
            <span className="ag-lines">
              <b>
                {check.changedCount === 1 ? "1 row changed" : `${check.changedCount} rows changed`} since you checked, so nothing was saved
              </b>
              <span>The changed rows are marked. Check them, then confirm again.</span>
            </span>
          </Note>
        )}

        <FilterPills
          label="Show rows"
          value={filter}
          onChange={(value) => setFilter(value as typeof filter)}
          options={filters.map((f) => ({
            value: f.value,
            label: (
              <>
                {f.label} <span className="ag-num">{f.count.toLocaleString("en-US")}</span>
              </>
            ),
          }))}
        />

        <ol aria-label="Rows" className="ag-import-rows">
          {shown.map((row) => (
            <RowCard key={row.sheetRow} row={row} />
          ))}
        </ol>

        <div className="ag-import-foot">
          <Button onClick={onConfirm} pending={pending} disabled={!pending && !canConfirm}>
            {pending ? "Saving…" : canConfirm ? confirmLabel(summary) : "Nothing to import"}
          </Button>
          {refusedCount > 0 && (
            <Button variant="ghost" onClick={() => download(refusedFileName(check.fileName), refusedAgentRowsCsv(check.rows))}>
              Download refused rows ({refusedCount.toLocaleString("en-US")})
            </Button>
          )}
          <Button variant="ghost" onClick={onStartOver} disabled={pending}>
            Upload a different file
          </Button>
        </div>
      </div>
    </Card>
  )
}

function RowCard({ row }: { row: AgentImportRow }) {
  return (
    <li aria-label={`Row ${row.sheetRow}`} className="ag-import-row" data-changed={row.changed ? "" : undefined}>
      <div className="ag-row">
        <span className="ag-strong">Row {row.sheetRow}</span>
        <Tag tone={CLASS_TONES[row.class]}>{CLASS_LABELS[row.class]}</Tag>
        {row.changed && <Tag tone="wait">Changed since you checked</Tag>}
      </div>
      {row.reason && <p className="ag-p ag-wrap ag-gap-top">{row.reason}</p>}
      <dl>
        {VALUE_KEYS.map(({ key, label, normalized }) => {
          const original = row.original[key]
          const saved = row.normalized[normalized]
          if (original.trim() === "" && saved === null) return null
          return (
            <div key={key} className="contents">
              <dt>{label}</dt>
              <dd>
                {/* Spaces kept, so extra ones show. */}
                <span className="ag-mono ag-pre">{original}</span>
                {saved !== null && saved !== original && (
                  <>
                    {" "}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">saved as</span> <span className="ag-mono ag-strong">{saved}</span>
                  </>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      {row.agent && (
        <p className="ag-small ag-quiet ag-wrap ag-gap-top">
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
  const titleId = useId()
  const card = useRef<HTMLElement>(null)
  // The confirm button has gone: the result's title takes focus, so it is read out.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>(`[id="${titleId}"]`)?.focus()
  }, [titleId])
  return (
    <TaskCard ref={card} aria-labelledby={titleId}>
      <FinishedState titleId={titleId} title={<span className="ag-wrap">{result.fileName} is imported</span>}>
        <ul className="ag-list ag-left">
          <li>{plural(result.created, "agent", "agents")} created, Approved.</li>
          {result.emailsAdded > 0 && <li>{plural(result.emailsAdded, "email", "emails")} added to agents who had none.</li>}
          <li>{plural(result.skipped, "row", "rows")} skipped.</li>
        </ul>
        <p className="ag-p ag-quiet">No email was sent. Imported emails count as confirmed by you.</p>
        {refusedCount > 0 && (
          <p className="ag-p ag-quiet">
            {plural(refusedCount, "row was", "rows were")} refused. Download them, fix each one using its reason, and upload that file.
          </p>
        )}
        <div className="ag-stack">
          <ButtonLink href={`/staff/agents?status=all&import=${result.batchId}`} size="wide" chevron>
            See the agents this import created
          </ButtonLink>
          {refusedCount > 0 && (
            <Button variant="ghost" size="wide" onClick={() => download(refusedFileName(result.fileName), refusedAgentRowsCsv(result.rows))}>
              Download refused rows ({refusedCount.toLocaleString("en-US")})
            </Button>
          )}
          <Button variant="ghost" size="wide" onClick={onStartOver}>
            Import another file
          </Button>
        </div>
      </FinishedState>
    </TaskCard>
  )
}
