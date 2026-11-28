import type { SupabaseClient } from "@supabase/supabase-js"

import type { InterviewFeeStatus, InterviewResult } from "./interviews"
import { isClosed, type DayOrBoarding, type LeadClass, type LeadClosure, type LeadStatus } from "./leads"
import type { Result } from "./result"

// The Interviews screen's list: one enrollment year's interview
// registrations, all of them, so the screen can search, filter, sort and page
// them in the browser as staff type (Interviews revamp, prototype
// 1MpUKuX27V6pc1CS1z1URz v5). Everything is read on the caller's session, so
// row-level security decides what they see: staff with leads.view see every
// registration, anyone else sees none.

export type InterviewListItem = {
  id: string
  serialNumber: number
  // When the S/N was issued, an ISO timestamp.
  registeredAt: string
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

type InterviewListRow = {
  id: string
  serial_number: number
  registered_at: string
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
  "id, serial_number, registered_at, result, score, fee_status, lead:leads!inner(id, admission_number, student_name, class_name, day_or_boarding, status, closure)"

// The API hands back at most 1,000 rows a request (supabase/config.toml,
// max_rows), so a year is read in chunks of that size.
export const INTERVIEW_CHUNK = 1000

// Every registration of an enrollment year, in S/N order. A smaller `chunk`
// is for tests.
export async function listYearInterviews(
  supabase: SupabaseClient,
  enrollmentYear: number,
  { chunk = INTERVIEW_CHUNK }: { chunk?: number } = {},
): Promise<Result<InterviewListItem[], "unavailable">> {
  const rows: InterviewListRow[] = []
  for (let from = 0; ; from += chunk) {
    const { data, error } = await supabase
      .from("interviews")
      .select(INTERVIEW_LIST_COLUMNS)
      .eq("serial_year", enrollmentYear)
      .order("serial_number", { ascending: true })
      .range(from, from + chunk - 1)
      .overrideTypes<InterviewListRow[], { merge: false }>()
    if (error) {
      console.error("Could not list interviews", error)
      return { ok: false, error: "unavailable" }
    }
    rows.push(...(data ?? []))
    if ((data ?? []).length < chunk) break
  }

  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      registeredAt: row.registered_at,
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

// How many registrations an enrollment year has, for the year list.
export async function countYearInterviews(supabase: SupabaseClient, enrollmentYear: number): Promise<Result<number, "unavailable">> {
  const { count, error } = await supabase.from("interviews").select("id", { count: "exact", head: true }).eq("serial_year", enrollmentYear)
  if (error) {
    console.error("Could not count interviews", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: count ?? 0 }
}
