import type { SupabaseClient } from "@supabase/supabase-js"

import type { LeadClass, LeadClosure, LeadStatus } from "./leads"
import type { Result } from "./result"

// The Today page's reads (#226): the day's interviews, the results waiting to
// be sent, and the newest leads. Everything is read on the caller's session,
// so row-level security decides what they see: staff with leads.view see
// every lead and interview, anyone else sees none and reads zero.

// How many of the day's students the page names.
export const INTERVIEWS_NAMED = 3

export type InterviewsOnDate = {
  count: number
  // The first students by S/N, at most INTERVIEWS_NAMED of them.
  students: string[]
}

type InterviewOnDateRow = { id: string; lead: { student_name: string } }

// The interviews held on `date` (YYYY-MM-DD, a calendar date in Tanzania):
// how many, and who the first few were.
export async function listInterviewsOn(supabase: SupabaseClient, date: string): Promise<Result<InterviewsOnDate, "unavailable">> {
  const { data, count, error } = await supabase
    .from("interviews")
    .select("id, lead:leads!inner(student_name)", { count: "exact" })
    .eq("interview_date", date)
    .order("serial_year", { ascending: true })
    .order("serial_number", { ascending: true })
    .limit(INTERVIEWS_NAMED)
    .overrideTypes<InterviewOnDateRow[], { merge: false }>()
  if (error) {
    console.error("Could not list the day's interviews", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { count: count ?? 0, students: (data ?? []).map((row) => row.lead.student_name) } }
}

export type ResultsReadyToSend = {
  count: number
  // The earliest enrollment year with a result waiting, where the Interviews
  // screen's Ready to send filter opens; null when none waits.
  year: number | null
}

// The results that can be sent and haven't been: the lead's current
// interview, its fee Paid, a result recorded and no release yet, or a result
// changed since the last one. The rule is the database's
// interview_release_status, the one the Interviews screen filters on.
export async function countResultsReadyToSend(supabase: SupabaseClient): Promise<Result<ResultsReadyToSend, "unavailable">> {
  const { data, count, error } = await supabase
    .from("interviews")
    .select("serial_year", { count: "exact" })
    .eq("result_ready_to_send", true)
    .order("serial_year", { ascending: true })
    .limit(1)
    .overrideTypes<{ serial_year: number }[], { merge: false }>()
  if (error) {
    console.error("Could not count the results ready to send", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { count: count ?? 0, year: data?.[0]?.serial_year ?? null } }
}

// How many of the newest leads the page lists.
export const LATEST_LEADS = 5

export type LatestLead = {
  id: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  status: LeadStatus
  closure: LeadClosure | null
  createdAt: string
}

type LatestLeadRow = {
  id: string
  admission_number: string
  student_name: string
  class_name: LeadClass
  status: LeadStatus
  closure: LeadClosure | null
  created_at: string
}

// The most recently created leads, newest first, whatever their status or
// closure mark.
export async function listLatestLeads(supabase: SupabaseClient, limit: number = LATEST_LEADS): Promise<Result<LatestLead[], "unavailable">> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, admission_number, student_name, class_name, status, closure, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .overrideTypes<LatestLeadRow[], { merge: false }>()
  if (error) {
    console.error("Could not list the latest leads", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      admissionNumber: row.admission_number,
      studentName: row.student_name,
      className: row.class_name,
      status: row.status,
      closure: row.closure,
      createdAt: row.created_at,
    })),
  }
}
