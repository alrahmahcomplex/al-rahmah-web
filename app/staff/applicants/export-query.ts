import type { LeadSearch } from "@/lib/services/leads"

import { leadsHref } from "./search-params"

// The export sheet's choices as the query string of the export route
// (export/route.ts reads it back with parseExportRequest). The sheet renders
// these pairs as the hidden fields of its GET form, so what the form sends
// and what this module builds are the same thing.
//
//   preset   class, calls, codes, full or custom
//   col      one per ticked choice, for custom only
//   scope    shown (the list as filtered now), year or all
//   year     the Enrollment year, for scope=year
//   q, status, closure, earlier_link, import
//            the list's own search, for scope=shown, as the list's URL has it

export const EXPORT_PATH = "/staff/applicants/export"

export type ExportScope = "shown" | "year" | "all"

export type ExportRequest = {
  preset: string
  // Choice keys (EXPORT_CHOICES), used only by the custom preset.
  choices: readonly string[]
  scope: ExportScope
  year?: number
  // The list's search as the page shows it.
  search: Omit<LeadSearch, "page">
}

export function exportParams(request: ExportRequest): [string, string][] {
  const out: [string, string][] = [
    ["preset", request.preset],
    ["scope", request.scope],
  ]
  if (request.preset === "custom") for (const choice of request.choices) out.push(["col", choice])
  if (request.scope === "year" && request.year !== undefined) out.push(["year", String(request.year)])
  if (request.scope === "shown") {
    const listQuery = leadsHref({ ...request.search, page: 1 }).split("?")[1] ?? ""
    for (const [key, value] of new URLSearchParams(listQuery)) out.push([key, value])
  }
  return out
}

export function exportHref(request: ExportRequest): string {
  return `${EXPORT_PATH}?${new URLSearchParams(exportParams(request)).toString()}`
}
