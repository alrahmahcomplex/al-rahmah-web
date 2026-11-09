"use client"

import { DownloadIcon, LockIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { SheetForm } from "@/components/staff/sheet-form"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { LeadSearch } from "@/lib/services/leads"
import type { ExportTier } from "@/lib/services/student-export"

import { exportCounts, type ExportCounts } from "./export-actions"
import type { ExportOptions } from "./export/options"
import { EXPORT_PATH, exportParams, type ExportScope } from "./export-query"

const SELECT_CLASS =
  "h-10 w-full min-w-0 staff-touch:h-11 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"

const GROUPS: { tier: ExportTier; heading: string; locked: string }[] = [
  { tier: "view", heading: "Applicant", locked: "" },
  { tier: "contact", heading: "Parent contact", locked: "Parent contact needs the Export applicants permission." },
  { tier: "full", heading: "Full data", locked: "Full data is the Super Admin’s export only: payments, results, notes and history." },
]

const count = (n: number) => n.toLocaleString("en-US")
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`

// Export on the Applicants list: which applicants, which columns, then a CSV
// from the export route. Every holder of leads.view may export the
// applicant columns; parent contacts need leads.export and Full data is the
// Super Admin's. The download is a plain GET form, so the browser saves the
// file itself.
export function ExportSheet({
  options,
  search,
  shownCount,
  years,
}: {
  options: ExportOptions
  // The list's search as the page shows it, for "The list as filtered now".
  search: Omit<LeadSearch, "page">
  // How many applicants the list shows; null when it couldn't be read.
  shownCount: number | null
  years: number[]
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<ExportScope>("shown")
  const [year, setYear] = useState(years[0])
  const [preset, setPreset] = useState(options.presets[0].key)
  const [ticked, setTicked] = useState<string[]>(options.presets[0].choices)
  const [counts, setCounts] = useState<ExportCounts>(null)
  const [, startCounting] = useTransition()

  function openChange(next: boolean) {
    setOpen(next)
    if (next) {
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

  function submitted() {
    toast.success(rows === null ? "Exported. Recorded in the audit history." : `Exported ${plural(rows, "applicant")}. Recorded in the audit history.`)
    // After the browser has taken the form's fields.
    setTimeout(() => setOpen(false), 0)
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => openChange(true)}>
        <DownloadIcon aria-hidden="true" />
        Export
      </Button>
      <SheetForm
        open={open}
        onOpenChange={openChange}
        title="Export applicants"
        meta={<span>A CSV of the columns you choose. Each export is recorded.</span>}
        form={{ action: EXPORT_PATH, method: "get", onSubmit: submitted }}
        footerStart={
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {rows === null ? plural(columns, "column") : `${plural(rows, "row")}, ${plural(columns, "column")}`}
          </span>
        }
        footer={
          <Button type="submit" disabled={columns === 0}>
            Download CSV
          </Button>
        }
      >
        {fields.map(([name, value], index) => (
          <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
        ))}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="export-scope">Which applicants</Label>
          <select
            id="export-scope"
            className={SELECT_CLASS}
            value={scope === "year" ? `year-${year}` : scope}
            onChange={(event) => {
              const value = event.target.value
              if (value.startsWith("year-")) {
                setScope("year")
                setYear(Number(value.slice(5)))
              } else setScope(value as ExportScope)
            }}
          >
            <option value="shown">The list as filtered now</option>
            {years.map((each) => (
              <option key={each} value={`year-${each}`}>
                Enrollment year {each}
              </option>
            ))}
            <option value="all">Every applicant</option>
          </select>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-[13px] font-semibold text-muted-foreground">Columns</legend>
          <div className="flex flex-col gap-2">
            {options.presets.map((each) => (
              <label
                key={each.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 ring-1 ring-slate-300 transition-colors hover:bg-slate-50 has-[:checked]:bg-blue-50 has-[:checked]:ring-blue-600"
              >
                <input
                  type="radio"
                  name="export-preset"
                  form="none"
                  value={each.key}
                  checked={each.key === current.key}
                  onChange={() => choosePreset(each.key)}
                  className="mt-0.5 size-4 accent-blue-600"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">{each.label}</span>
                  <span className="mt-0.5 text-[12.5px] text-muted-foreground">{each.description}</span>
                </span>
              </label>
            ))}
          </div>

          {custom && (
            <div className="flex flex-col gap-1" role="group" aria-label="Choose columns">
              {GROUPS.map((group) => {
                if (!options.tiers[group.tier]) {
                  return (
                    <p key={group.tier} className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-[13px] text-muted-foreground">
                      <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      {group.locked}
                    </p>
                  )
                }
                return (
                  <div key={group.tier} className="flex flex-col gap-0.5">
                    <p className="px-2.5 pt-2.5 pb-0.5 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{group.heading}</p>
                    {options.choices
                      .filter((choice) => choice.tier === group.tier)
                      .map((choice) => (
                        <label key={choice.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-slate-50">
                          <input
                            type="checkbox"
                            form="none"
                            checked={ticked.includes(choice.key)}
                            onChange={(event) => toggle(choice.key, event.target.checked)}
                            className="size-4 accent-blue-600"
                          />
                          {choice.label}
                        </label>
                      ))}
                  </div>
                )
              })}
            </div>
          )}
        </fieldset>

        {note && <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-[13px] text-muted-foreground">{note}</p>}
      </SheetForm>
    </>
  )
}
