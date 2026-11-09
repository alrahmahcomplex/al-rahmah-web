import "server-only"

import {
  EXPORT_PRESETS,
  EXPORT_ROW_CAP,
  columnsForChoices,
  filtersFromSearch,
  isExportPreset,
  type ExportColumn,
  type ExportFilters,
  type ExportPreset,
  type StudentExportError,
} from "@/lib/services/student-export"

import { parseLeadSearch } from "../search-params"

// The export route's query string (built by export-query.ts) read back as
// the preset, the columns and the filters. Anything it can't read is
// refused rather than guessed: an export always holds what was asked.

export type ParsedExport = { preset: ExportPreset; columns: ExportColumn[]; filters: ExportFilters }

export function parseExportRequest(params: URLSearchParams): ParsedExport | null {
  const preset = params.get("preset") ?? ""
  if (!isExportPreset(preset)) return null
  const columns =
    preset === "custom" ? columnsForChoices(params.getAll("col")) : [...EXPORT_PRESETS.find((each) => each.key === preset)!.columns]
  if (columns.length === 0) return null

  const scope = params.get("scope")
  let filters: ExportFilters
  if (scope === "all") filters = { closure: "all" }
  else if (scope === "year") {
    const year = params.get("year") ?? ""
    if (!/^2\d{3}$/.test(year)) return null
    filters = { closure: "all", enrollmentYear: Number(year) }
  } else if (scope === "shown") {
    const search = parseLeadSearch(Object.fromEntries(["q", "status", "closure", "earlier_link", "import"].map((key) => [key, params.get(key) ?? undefined])))
    filters = { ...filtersFromSearch(search), ...(search.importBatchId ? { importBatchId: search.importBatchId } : {}) }
  } else return null

  return { preset, columns, filters }
}

// What the browser shows when the route refuses, as plain text. The sheet
// hides what the person may not have, so these are rare.
export const EXPORT_REFUSALS = {
  invalid: "This export can't be read. Close this tab, open Export again and choose the columns.",
  forbidden: "You can't export these columns. Ask the Super Admin if you need them.",
  unavailable: "The export could not be made. Try again in a moment.",
} as const

export function tooManyMessage(rowCount: number | null): string {
  const cap = EXPORT_ROW_CAP.toLocaleString("en-US")
  const found = rowCount === null ? "" : ` (${rowCount.toLocaleString("en-US")})`
  return `More applicants match${found} than one export holds, ${cap}. Export one Enrollment year at a time, or filter the list first.`
}

// The status and text for each refusal.
export function refusalOf(error: StudentExportError): { status: number; text: string } {
  switch (error.kind) {
    case "forbidden":
      return { status: 403, text: EXPORT_REFUSALS.forbidden }
    case "invalid":
      return { status: 400, text: EXPORT_REFUSALS.invalid }
    case "too-many":
      return { status: 413, text: tooManyMessage(error.rowCount) }
    case "unavailable":
      return { status: 503, text: EXPORT_REFUSALS.unavailable }
  }
}
