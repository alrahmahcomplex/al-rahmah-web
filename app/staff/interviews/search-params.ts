import type { InterviewFeeStatus } from "@/lib/services/interviews"
import { LAST_INTERVIEW_PAGE, type InterviewListSearch, type InterviewResultFilter } from "@/lib/services/interview-list"

// The Interviews screen keeps its year, filters and page in the URL (year,
// result, fee, page), so interview day's list can be shared, bookmarked and
// paged with the back button working.

type SearchParams = { [key: string]: string | string[] | undefined }

export type InterviewScreenSearch = Omit<InterviewListSearch, "enrollmentYear"> & { enrollmentYear?: number }

const RESULT_PARAMS: Record<string, InterviewResultFilter> = { none: "none", passed: "Passed", failed: "Failed" }
const RESULT_PARAM: Record<InterviewResultFilter, string> = { none: "none", Passed: "passed", Failed: "failed" }
const FEE_PARAMS: Record<string, InterviewFeeStatus> = { paid: "Paid", "not-paid": "Not Paid" }
const FEE_PARAM: Record<InterviewFeeStatus, string> = { Paid: "paid", "Not Paid": "not-paid" }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

// What the URL asks for. A missing or unreadable year is left for the page to
// choose (defaultInterviewYear); anything else unreadable means no filter and
// the first page.
export function parseInterviewSearch(params: SearchParams): InterviewScreenSearch {
  const yearText = first(params.year) ?? ""
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN
  const page = Number(first(params.page))
  return {
    enrollmentYear: year >= 2000 && year <= 2100 ? year : undefined,
    result: RESULT_PARAMS[first(params.result) ?? ""],
    feeStatus: FEE_PARAMS[first(params.fee) ?? ""],
    page: Number.isInteger(page) && page > 0 && page <= LAST_INTERVIEW_PAGE ? page : 1,
  }
}

// The year the screen opens on: the current year when it has registrations.
// Interviews run ahead of the intake they are for, so when it has none, the
// next year that has some; failing that the latest one, and with no
// registrations at all, the current year.
export function defaultInterviewYear(years: readonly number[], currentYear: number): number {
  if (years.includes(currentYear)) return currentYear
  const later = years.filter((year) => year > currentYear)
  if (later.length > 0) return Math.min(...later)
  return years.length > 0 ? Math.max(...years) : currentYear
}

// The URL of a list, with some of it changed. The year is always written, so
// a shared link shows the same year to everyone; the first page and absent
// filters are left out.
export function interviewsHref(search: InterviewListSearch, changes: Partial<InterviewListSearch> = {}) {
  const { enrollmentYear, result, feeStatus, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  params.set("year", String(enrollmentYear))
  if (result) params.set("result", RESULT_PARAM[result])
  if (feeStatus) params.set("fee", FEE_PARAM[feeStatus])
  if (page > 1) params.set("page", String(page))
  return `/staff/interviews?${params.toString()}`
}
