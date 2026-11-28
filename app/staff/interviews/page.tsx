import type { Metadata } from "next"

import { Note, PageHeader, pageTitle } from "@/components/kit"
import { currentAdmissionYear, tanzaniaToday } from "@/lib/school-calendar"
import { countYearInterviews, listInterviewYears, listYearInterviews } from "@/lib/services/interview-list"
import { listReleaseStatus, type ReleaseStatus } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

import { closedState } from "../applicants/[id]/closed-state"
import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { defaultInterviewYear, parseYear, type BoardRow } from "./board"
import { InterviewsBoard } from "./interviews-board"
import { interviewRows } from "./rows"
import "./interviews.css"

export const metadata: Metadata = {
  title: pageTitle("Interviews"),
}

// The release status is read for this many interviews at a time: the API
// returns at most 1,000 rows a request.
const STATUS_CHUNK = 500

// Every interview registration of an enrollment year, newest first, searched,
// filtered and sorted in the browser (prototype 1MpUKuX27V6pc1CS1z1URz v5).
// The server reads the year; the rest of the address is the list's.
export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return <StaffForbidden />

  const supabase = await createClient()
  const asked = parseYear((await searchParams).year)
  const years = await listInterviewYears(supabase)
  if (!years.ok) return <Unavailable />

  const year = asked ?? defaultInterviewYear(years.data, currentAdmissionYear())
  const list = await listYearInterviews(supabase, year)
  if (!list.ok) return <Unavailable />

  // The Result sent column: the release status of every interview on the list.
  const ids = list.data.map((interview) => interview.id)
  const statuses = new Map<string, ReleaseStatus>()
  for (let at = 0; at < ids.length; at += STATUS_CHUNK) {
    const read = await listReleaseStatus(supabase, ids.slice(at, at + STATUS_CHUNK))
    if (!read.ok) return <Unavailable />
    for (const [id, status] of read.data) statuses.set(id, status)
  }

  const rows: BoardRow[] = interviewRows(list.data, statuses).map((interview) => ({
    id: interview.id,
    leadId: interview.lead.id,
    serialNumber: interview.serialNumber,
    admissionNumber: interview.lead.admissionNumber,
    studentName: interview.lead.studentName,
    className: interview.lead.className,
    dayOrBoarding: interview.lead.dayOrBoarding,
    registeredOn: tanzaniaToday(new Date(interview.registeredAt)),
    result: interview.result,
    score: interview.score,
    feeStatus: interview.feeStatus,
    sentOn: interview.sentOn,
    closed: interview.lead.closed ? { text: closedState(interview.lead), declined: interview.lead.status === "Declined" } : null,
  }))

  // The year on show is offered even when it has no registrations, so the
  // year list always says which one is open.
  const offered = [...new Set([...years.data, year])].sort((a, b) => a - b)
  const counts = await Promise.all(offered.map((each) => (each === year ? null : countYearInterviews(supabase, each))))

  return (
    <InterviewsBoard
      year={year}
      years={offered.map((each, i) => ({ year: each, count: each === year ? rows.length : counts[i]?.ok ? counts[i].data : 0 }))}
      rows={rows}
      today={tanzaniaToday()}
      canRecord={staff.permissions.includes("interviews.record")}
      canMarkFee={staff.permissions.includes("interview_payments.record")}
    />
  )
}

function Unavailable() {
  return (
    <>
      <PageHeader title="Interviews" />
      <Note tone="bad" role="alert">
        Interviews could not be loaded. Try again in a moment.
      </Note>
    </>
  )
}
