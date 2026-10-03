import type { SupabaseClient } from "@supabase/supabase-js"

import type { InterviewFeeStatus, InterviewResult } from "./interviews"
import { isClosed, type DayOrBoarding, type LeadClass, type LeadClosure, type LeadStatus } from "./leads"
import type { Result } from "./result"

// The Interviews screen's list (slice 5, #70): one enrollment year's
// interview registrations in S/N order. Everything is read on the caller's
// session, so row-level security decides what they see: staff with
// leads.view see every registration, anyone else sees none.

// Which results the list shows: no result yet, Passed or Failed.
export const INTERVIEW_RESULT_FILTERS = ["none", "Passed", "Failed"] as const
export type InterviewResultFilter = (typeof INTERVIEW_RESULT_FILTERS)[number]

export const INTERVIEW_FEE_FILTERS = ["Paid", "Not Paid"] as const satisfies readonly InterviewFeeStatus[]

export const INTERVIEWS_PER_PAGE = 50

// A page number past any real list. Larger ones would overflow the offset.
export const LAST_INTERVIEW_PAGE = 10_000

export type InterviewListSearch = {
  // The enrollment year the S/N was issued in.
  enrollmentYear: number
  // Left out: every result.
  result?: InterviewResultFilter
  // Left out: Paid and Not Paid.
  feeStatus?: InterviewFeeStatus
  // From 1.
  page: number
}

export type InterviewListItem = {
  id: string
  serialNumber: number
  lead: {
    id: string
    admissionNumber: string
    studentName: string
    className: LeadClass
    dayOrBoarding: DayOrBoarding
    status: LeadStatus
    closure: LeadClosure | null
    // Declined, Inactive or Archived. A closed lead stays on the list, so the
    // S/Ns run without gaps.
    closed: boolean
  }
  // The date, result and score are all set or all empty.
  result: InterviewResult | null
  score: number | null
  feeStatus: InterviewFeeStatus
}

export type InterviewList = {
  interviews: InterviewListItem[]
  total: number
  page: number
  pageCount: number
}

type InterviewListRow = {
  id: string
  serial_number: number
  result: InterviewResult | null
  score: number | string | null
  fee_status: InterviewFeeStatus
  lead: {
    id: string
    admission_number: string
    student_name: string
    class_name: LeadClass
    day_or_boarding: DayOrBoarding
    status: LeadStatus
    closure: LeadClosure | null
  }
}

const INTERVIEW_LIST_COLUMNS =
  "id, serial_number, result, score, fee_status, lead:leads!inner(id, admission_number, student_name, class_name, day_or_boarding, status, closure)"

// One page of an enrollment year's registrations, in S/N order, under the
// result and fee filters.
export async function listInterviews(
  supabase: SupabaseClient,
  search: InterviewListSearch,
): Promise<Result<InterviewList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? Math.min(search.page, LAST_INTERVIEW_PAGE) : 1

  const build = (head = false) => {
    let list = supabase
      .from("interviews")
      .select(INTERVIEW_LIST_COLUMNS, { count: "exact", head })
      .eq("serial_year", search.enrollmentYear)
    if (search.result === "none") list = list.is("result", null)
    else if (search.result) list = list.eq("result", search.result)
    if (search.feeStatus) list = list.eq("fee_status", search.feeStatus)
    return list.order("serial_number", { ascending: true })
  }

  const from = (page - 1) * INTERVIEWS_PER_PAGE
  let { data, count, error } = await build()
    .range(from, from + INTERVIEWS_PER_PAGE - 1)
    .overrideTypes<InterviewListRow[], { merge: false }>()
  // PostgREST refuses a range past the last row. That page is empty, and a
  // count alone still says how many pages there are.
  if (error?.code === "PGRST103") {
    ;({ count, error } = await build(true))
    data = []
  }
  if (error) {
    console.error("Could not list interviews", error)
    return { ok: false, error: "unavailable" }
  }

  const total = count ?? 0
  return {
    ok: true,
    data: {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / INTERVIEWS_PER_PAGE)),
      interviews: (data ?? []).map((row) => ({
        id: row.id,
        serialNumber: row.serial_number,
        lead: {
          id: row.lead.id,
          admissionNumber: row.lead.admission_number,
          studentName: row.lead.student_name,
          className: row.lead.class_name,
          dayOrBoarding: row.lead.day_or_boarding,
          status: row.lead.status,
          closure: row.lead.closure,
          closed: isClosed(row.lead),
        },
        result: row.result,
        score: row.score === null ? null : Number(row.score),
        feeStatus: row.fee_status,
      })),
    },
  }
}

// The enrollment years that have interview registrations, oldest first.
// Empty for anyone without leads.view.
export async function listInterviewYears(supabase: SupabaseClient): Promise<Result<number[], "unavailable">> {
  const { data, error } = await supabase.rpc("interview_years")
  // 42501: not granted, as for someone signed out. They see no years.
  if (error?.code === "42501") return { ok: true, data: [] }
  if (error) {
    console.error("Could not list the interview years", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: (data as number[]).map(Number) }
}
