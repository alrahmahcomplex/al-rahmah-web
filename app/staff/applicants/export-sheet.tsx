"use client"

import { useId, useState, useTransition } from "react"

import { Button, Checkbox, ChoiceTiles, Note, Select, Sheet, toast } from "@/components/kit"
import type { LeadSearch } from "@/lib/services/leads"
import type { ExportTier } from "@/lib/services/student-export"

import { exportCounts, type ExportCounts } from "./export-actions"
import type { ExportOptions } from "./export/options"
import { EXPORT_PATH, exportParams, type ExportScope } from "./export-query"

const GROUPS: { tier: ExportTier; heading: string; locked: string }[] = [
  { tier: "view", heading: "Applicant", locked: "" },
  { tier: "contact", heading: "Parent contact", locked: "Parent contact needs the Export applicants permission." },
  { tier: "full", heading: "Full data", locked: "Full data is the Super Admin’s export only: payments, results, notes and history." },
]

// When the answer is no file and no refusal the route wrote: the connection
// dropped, or the sign-in ended and the answer was the sign-in page.
const EXPORT_LOST = "The export could not be downloaded. Check your connection, reload the page and try again."

const count = (n: number) => n.toLocaleString("en-US")
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`

// Export on the Applicants list: which applicants, which columns, then a CSV
// from the export route. Every holder of leads.view may export the
// applicant columns; parent contacts need leads.export and Full data is the
// Super Admin's. The sheet fetches the file and says Exported only once the
// route has answered with it, since only then is the export recorded; a
// refusal stays in the sheet with its reason.
export function ExportSheet({
  options,
  search,
  shownCount,
  years,
  defaultYear = years[0],
}: {
  options: ExportOptions
  // The list's search as the page shows it, for "The list as filtered now".
  search: Omit<LeadSearch, "page">
  // How many applicants the list shows; null when it couldn't be read.
  shownCount: number | null
  years: number[]
  defaultYear?: number
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<ExportScope>("shown")
  const [year, setYear] = useState(years.includes(defaultYear) ? defaultYear : years[0])
  const [preset, setPreset] = useState(options.presets[0].key)
  const [ticked, setTicked] = useState<string[]>(options.presets[0].choices)
  const [counts, setCounts] = useState<ExportCounts>(null)
  const [, startCounting] = useTransition()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [downloading, startDownload] = useTransition()

  function openChange(next: boolean) {
    if (downloading) return
    setOpen(next)
    if (next) {
      setRefusal(null)
      startCounting(async () => {
        try {
          setCounts(await exportCounts())
        } catch {
          setCounts(null)
        }
      })
    }
  }

  function choosePreset(key: string) {
    setPreset(key)
    // Choose columns starts from the boxes the last preset ticked.
    const chosen = options.presets.find((each) => each.key === key)
    if (chosen && key !== "custom") setTicked(chosen.choices)
  }

  function toggle(choice: string, on: boolean) {
    setTicked((current) => (on ? [...current, choice] : current.filter((each) => each !== choice)))
  }

  const current = options.presets.find((each) => each.key === preset) ?? options.presets[0]
  const custom = current.key === "custom"
  // Only choices whose tier is held count, whatever was ticked before.
  const chosen = custom ? options.choices.filter((choice) => ticked.includes(choice.key) && options.tiers[choice.tier]) : []
  const columns = custom ? chosen.reduce((sum, choice) => sum + choice.columns, 0) : current.columns
  const tiers = new Set<ExportTier>(custom ? chosen.map((choice) => choice.tier) : [current.tier])
  const note = tiers.has("full")
    ? "Includes payments and notes. Keep this file inside the school."
    : tiers.has("contact")
      ? "Includes parent names and phone numbers, personal data under the Personal Data Protection Act. Share only with staff who need it."
      : null
  const rows = scope === "shown" ? shownCount : scope === "year" ? (counts?.byYear[year] ?? null) : (counts?.all ?? null)
  const fields = exportParams({ preset: current.key, choices: chosen.map((choice) => choice.key), scope, year, search })

  function download(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (downloading) return
    setRefusal(null)
    const address = `${EXPORT_PATH}?${new URLSearchParams(fields)}`
    startDownload(async () => {
      // The connection can drop before the answer or while its body is read:
      // either way there is no file, and the sheet says so.
      let response: Response
      let file: Blob | null = null
      let refused: string | null = null
      try {
        response = await fetch(address, { cache: "no-store" })
        const type = response.headers.get("Content-Type") ?? ""
        if (response.ok && type.startsWith("text/csv")) file = await response.blob()
        // The route's refusals are short plain text with their own status.
        else refused = !response.ok && type.startsWith("text/plain") ? await response.text() : EXPORT_LOST
      } catch {
        setRefusal(EXPORT_LOST)
        return
      }
      if (!file) {
        setRefusal(refused ?? EXPORT_LOST)
        return
      }
      const link = document.createElement("a")
      link.href = URL.createObjectURL(file)
      link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "applicants.csv"
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
      const exported = Number(response.headers.get("X-Row-Count"))
      toast(`Exported ${plural(exported, "applicant")}. Recorded in the audit history.`)
      setOpen(false)
    })
  }

  const formId = useId()
  const scopeId = useId()
  return (
    <>
      <Button variant="ghost" size="small" onClick={() => openChange(true)}>
        Export
      </Button>
      <Sheet
        open={open}
        onOpenChange={openChange}
        placement="side"
        title="Export applicants"
        hint="A CSV of the columns you choose. Each export is recorded."
        closeLabel="Close"
        foot={
          <>
            <p className="ap-small" aria-live="polite">
              {rows === null ? plural(columns, "column") : `${plural(rows, "row")}, ${plural(columns, "column")}`}
            </p>
            <Button type="submit" form={formId} size="wide" pending={downloading} disabled={!downloading && columns === 0}>
              {downloading ? "Preparing…" : "Download CSV"}
            </Button>
          </>
        }
      >
        <form id={formId} action={EXPORT_PATH} method="get" onSubmit={download} className="ap-form">
          {fields.map(([name, value], index) => (
            <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
          ))}

          <div className="ap-field">
            <label htmlFor={scopeId} className="ap-label">
              Which applicants
            </label>
            <Select
              id={scopeId}
              value={scope === "year" ? `year-${year}` : scope}
              onValueChange={(value) => {
                if (value.startsWith("year-")) {
                  setScope("year")
                  setYear(Number(value.slice(5)))
                } else setScope(value as ExportScope)
              }}
              options={[
                { value: "shown", label: "The list as filtered now" },
                ...years.map((each) => ({ value: `year-${each}`, label: `Enrollment year ${each}` })),
                { value: "all", label: "Every applicant" },
              ]}
            />
          </div>

          <ChoiceTiles
            name="export-preset"
            legend={<span className="ap-legend">Columns</span>}
            value={current.key}
            onChange={choosePreset}
            options={options.presets.map((each) => ({ value: each.key, label: each.label, description: each.description }))}
          >
            {custom && (
              <div className="ap-group" role="group" aria-label="Choose columns">
                {GROUPS.map((group) =>
                  !options.tiers[group.tier] ? (
                    <Note key={group.tier}>
                      {group.locked}
                    </Note>
                  ) : (
                    <div key={group.tier} className="ap-group">
                      <p className="ap-group-title">{group.heading}</p>
                      {options.choices
                        .filter((choice) => choice.tier === group.tier)
                        .map((choice) => (
                          <Checkbox
                            key={choice.key}
                            label={choice.label}
                            checked={ticked.includes(choice.key)}
                            onCheckedChange={(on) => toggle(choice.key, on)}
                          />
                        ))}
                    </div>
                  ),
                )}
              </div>
            )}
          </ChoiceTiles>

          {note && <Note tone="wait">{note}</Note>}
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}
