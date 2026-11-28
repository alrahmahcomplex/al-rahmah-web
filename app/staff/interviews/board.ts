import type { InterviewFeeStatus, InterviewResult } from "@/lib/services/interviews"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"

// The Interviews list's search, filters, sort and pages, worked out in the
// browser over the whole enrollment year (prototype 1MpUKuX27V6pc1CS1z1URz
// v5). Pure, so the screen and its tests share one set of rules. The state
// lives in the address (year, q, date, class, result, fee, sent, sort, dir,
// page, open), so a list can be shared and Back works.

// Which results the list shows: no result yet, Passed, Conditional or Failed.
export type InterviewResultFilter = "none" | InterviewResult

export type BoardRow = {
  id: string
  leadId: string
  serialNumber: number
  admissionNumber: string
  studentName: string
  className: LeadClass
  dayOrBoarding: string
  // The day the S/N was issued, in Tanzania, "YYYY-MM-DD".
  registeredOn: string
  result: InterviewResult | null
  score: number | null
  feeStatus: InterviewFeeStatus
  // The day the result on show was last sent, in Tanzania; null when never
  // sent or changed since.
  sentOn: string | null
  // A closed lead stays on the list, marked with how it closed.
  closed: { text: string; declined: boolean } | null
}

export type SortKey = "sn" | "registered" | "class" | "result" | "score" | "fee" | "sent"
export type Sort = { key: SortKey; dir: "asc" | "desc" }
export type SentFilter = "sent" | "not-sent"

export type BoardState = {
  q: string
  // "YYYY-MM-DD" registered on that day, or "" for any day.
  date: string
  classes: LeadClass[]
  result: InterviewResultFilter | ""
  fee: InterviewFeeStatus | ""
  sent: SentFilter | ""
  // null: the page's own order, the newest registration first.
  sort: Sort | null
  page: number
  // The interview whose sheet is open.
  open: string | null
}

export const EMPTY_BOARD: BoardState = { q: "", date: "", classes: [], result: "", fee: "", sent: "", sort: null, page: 1, open: null }

export const ROWS_PER_PAGE = 50

// ---------- search ----------

// Lower case without accents, so "amina" finds "AMINA" and "Amína".
function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

/** The words typed, as the search compares them. */
export function searchTerms(q: string): string[] {
  return plain(q).split(/[\s,]+/).filter(Boolean)
}

const digitsOf = (text: string) => text.replace(/\D/g, "").replace(/^0+/, "")

// Where each word of a name starts and ends.
function nameWords(name: string): { start: number; word: string }[] {
  const words: { start: number; word: string }[] = []
  for (const match of name.matchAll(/\S+/g)) words.push({ start: match.index, word: plain(match[0]) })
  return words
}

// Digits alone match the start of the number ("142" finds ADMSN-00142, not
// ADMSN-00420); with letters, the whole Admission Number as typed.
function matchesAdmission(admissionNumber: string, term: string): boolean {
  if (/[a-z]/.test(term)) return plain(admissionNumber).includes(term)
  const digits = digitsOf(term)
  return digits !== "" && digitsOf(admissionNumber).startsWith(digits)
}

/**
 * Whether a row answers the search: every word typed is the start of a part
 * of the name, in any order, or part of the Admission Number, or the S/N.
 * "ali" finds Ally but not Khalid; "142" finds ADMSN-00142 and S/N 142.
 */
export function matchesSearch(row: Pick<BoardRow, "studentName" | "admissionNumber" | "serialNumber">, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const words = nameWords(row.studentName)
  return terms.every(
    (term) =>
      words.some(({ word }) => word.startsWith(term)) || matchesAdmission(row.admissionNumber, term) || term === String(row.serialNumber),
  )
}

/** The stretches of a name the search matched: the longest typed start of each word. */
export function nameMarks(name: string, terms: readonly string[]): [number, number][] {
  if (terms.length === 0) return []
  return nameWords(name).flatMap(({ start, word }) => {
    const longest = Math.max(0, ...terms.filter((term) => word.startsWith(term)).map((term) => term.length))
    return longest > 0 ? [[start, start + longest] as [number, number]] : []
  })
}

/** The stretch of an Admission Number the search matched: the typed digits at the start of its number. */
export function admissionMarks(admissionNumber: string, terms: readonly string[]): [number, number][] {
  const number = admissionNumber.match(/[1-9]\d*$/)
  if (!number || number.index === undefined) return []
  const typed = terms.map(digitsOf).filter((digits) => digits !== "" && number[0].startsWith(digits))
  if (typed.length === 0) return []
  const longest = Math.max(...typed.map((digits) => digits.length))
  return [[number.index, number.index + longest]]
}

// ---------- filters ----------

export type FilterKey = "date" | "classes" | "result" | "fee" | "sent"

/** Whether a row passes the search and every filter, leaving out `skip` (for that filter's own counts). */
export function passes(row: BoardRow, state: BoardState, terms: readonly string[], skip?: FilterKey): boolean {
  if (skip !== "date" && state.date && row.registeredOn !== state.date) return false
  if (skip !== "classes" && state.classes.length > 0 && !state.classes.includes(row.className)) return false
  if (skip !== "result" && state.result && (state.result === "none" ? row.result !== null : row.result !== state.result)) return false
  if (skip !== "fee" && state.fee && row.feeStatus !== state.fee) return false
  if (skip !== "sent" && state.sent && (state.sent === "sent") !== (row.sentOn !== null)) return false
  return matchesSearch(row, terms)
}

/** Whether anything narrows the list: the search or any filter. */
export function narrowed(state: BoardState): boolean {
  return state.q.trim() !== "" || state.date !== "" || state.classes.length > 0 || state.result !== "" || state.fee !== "" || state.sent !== ""
}

// ---------- sort ----------

const RESULT_ORDER: readonly InterviewResult[] = ["Passed", "Conditional", "Failed"]

const SORT_VALUE: Record<SortKey, (row: BoardRow) => string | number | null> = {
  sn: (row) => row.serialNumber,
  registered: (row) => row.registeredOn,
  class: (row) => LEAD_CLASSES.indexOf(row.className),
  result: (row) => (row.result === null ? null : RESULT_ORDER.indexOf(row.result)),
  score: (row) => row.score,
  fee: (row) => (row.feeStatus === "Paid" ? 0 : 1),
  sent: (row) => row.sentOn,
}

/**
 * The rows in the chosen order; with no sort, the newest registration (the
 * highest S/N) first. Empty values go last either way; ties keep the newest
 * first.
 */
export function sortRows(rows: readonly BoardRow[], sort: Sort | null): BoardRow[] {
  const newestFirst = (a: BoardRow, b: BoardRow) => b.serialNumber - a.serialNumber
  if (!sort) return [...rows].sort(newestFirst)
  const value = SORT_VALUE[sort.key]
  const sign = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === null || y === null) return x === y ? newestFirst(a, b) : x === null ? 1 : -1
    if (x < y) return -sign
    if (x > y) return sign
    return newestFirst(a, b)
  })
}

/** A column's next sort when its arrows are pressed: lowest first, highest first, then the page's own order. */
export function nextSort(current: Sort | null, key: SortKey): Sort | null {
  if (!current || current.key !== key) return { key, dir: "asc" }
  return current.dir === "asc" ? { key, dir: "desc" } : null
}

// ---------- pages ----------

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / ROWS_PER_PAGE))
}

/** The page asked for, kept within the list, and its rows. */
export function pageOf<Row>(rows: readonly Row[], page: number): { page: number; rows: Row[]; from: number } {
  const last = pageCount(rows.length)
  const at = Math.min(Math.max(1, page), last)
  const from = (at - 1) * ROWS_PER_PAGE
  return { page: at, rows: rows.slice(from, from + ROWS_PER_PAGE), from }
}

// ---------- the address ----------

type Params = { get(name: string): string | null }

const RESULT_PARAMS: Record<string, InterviewResultFilter> = { none: "none", passed: "Passed", conditional: "Conditional", failed: "Failed" }
const RESULT_PARAM: Record<InterviewResultFilter, string> = { none: "none", Passed: "passed", Conditional: "conditional", Failed: "failed" }
const FEE_PARAMS: Record<string, InterviewFeeStatus> = { paid: "Paid", "not-paid": "Not Paid" }
const FEE_PARAM: Record<InterviewFeeStatus, string> = { Paid: "paid", "Not Paid": "not-paid" }
const SORT_KEYS: readonly SortKey[] = ["sn", "registered", "class", "result", "score", "fee", "sent"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** What the address asks of the list. Anything unreadable means no filter, the page's own order and the first page. */
export function parseBoard(params: Params): BoardState {
  const classes = (params.get("class") ?? "")
    .split(",")
    .filter((name): name is LeadClass => (LEAD_CLASSES as readonly string[]).includes(name))
  const sortKey = params.get("sort") as SortKey | null
  const dir = params.get("dir")
  const page = Number(params.get("page"))
  const open = params.get("open")
  const sent = params.get("sent")
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    date: DAY.test(params.get("date") ?? "") ? params.get("date")! : "",
    classes: [...new Set(classes)],
    result: RESULT_PARAMS[params.get("result") ?? ""] ?? "",
    fee: FEE_PARAMS[params.get("fee") ?? ""] ?? "",
    sent: sent === "sent" || sent === "not-sent" ? sent : "",
    sort: sortKey && SORT_KEYS.includes(sortKey) && (dir === "asc" || dir === "desc") ? { key: sortKey, dir } : null,
    page: Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1,
    open: open && UUID.test(open) ? open : null,
  }
}

/** The address's query for a list, without the year: defaults are left out. */
export function boardQuery(state: BoardState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q.trim()) params.set("q", state.q)
  if (state.date) params.set("date", state.date)
  if (state.classes.length > 0) params.set("class", [...state.classes].sort((a, b) => LEAD_CLASSES.indexOf(a) - LEAD_CLASSES.indexOf(b)).join(","))
  if (state.result) params.set("result", RESULT_PARAM[state.result])
  if (state.fee) params.set("fee", FEE_PARAM[state.fee])
  if (state.sent) params.set("sent", state.sent)
  if (state.sort) {
    params.set("sort", state.sort.key)
    params.set("dir", state.sort.dir)
  }
  if (state.page > 1) params.set("page", String(state.page))
  if (state.open) params.set("open", state.open)
  return params
}

/** The Interviews address for a year and a list. */
export function interviewsHref(year: number, state: BoardState = EMPTY_BOARD): string {
  const rest = boardQuery(state).toString()
  return `/staff/interviews?year=${year}${rest ? `&${rest}` : ""}`
}

// The year the screen opens on: the current admission year when it has
// registrations. Interviews run ahead of the intake they are for, so when it
// has none, the next year that has some; failing that the latest one, and with
// no registrations at all, the current admission year.
export function defaultInterviewYear(years: readonly number[], currentYear: number): number {
  if (years.includes(currentYear)) return currentYear
  const later = years.filter((year) => year > currentYear)
  if (later.length > 0) return Math.min(...later)
  return years.length > 0 ? Math.max(...years) : currentYear
}

/** The year in the address, or undefined when missing or unreadable. */
export function parseYear(param: string | string[] | undefined): number | undefined {
  const text = Array.isArray(param) ? param[0] : param
  if (!text || !/^\d{4}$/.test(text)) return undefined
  const year = Number(text)
  return year >= 2000 && year <= 2100 ? year : undefined
}
