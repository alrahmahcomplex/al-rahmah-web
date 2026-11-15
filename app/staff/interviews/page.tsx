import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { ButtonLink, Card, EmptyState, FilterPills, Note, PageHeader, pageTitle, Pagination } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { InterviewFeeStatus } from "@/lib/services/interviews"
import {
  listInterviews,
  listInterviewYears,
  type InterviewList,
  type InterviewListSearch,
  type InterviewResultFilter,
} from "@/lib/services/interview-list"
import { listReleaseStatus, type ReleaseStatus } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

import { leadTabHref } from "../applicants/[id]/tabs"
import { closedState } from "../applicants/[id]/closed-state"
import { requireStaff } from "../session"
import { InterviewsTable, type InterviewTableRow } from "./interviews-table"
import { interviewRows } from "./rows"
import { defaultInterviewYear, interviewsHref, parseInterviewSearch } from "./search-params"
import "./interviews.css"

export const metadata: Metadata = {
  title: pageTitle("Interviews"),
}

// Each filter group is a row of link pills, so a filter is a URL.
const RESULT_FILTERS: { value: InterviewResultFilter | undefined; label: string }[] = [
  { value: undefined, label: "Any result" },
  { value: "none", label: "No result yet" },
  { value: "Passed", label: "Passed" },
  { value: "Failed", label: "Failed" },
]

const FEE_FILTERS: { value: InterviewFeeStatus | undefined; label: string }[] = [
  { value: undefined, label: "Paid or not" },
  { value: "Paid", label: "Paid" },
  { value: "Not Paid", label: "Not Paid" },
]

// Slice 6's group: the families still waiting for their result.
const RELEASE_FILTERS: { value: true | undefined; label: string }[] = [
  { value: undefined, label: "Sent or not" },
  { value: true, label: "Ready to send" },
]

// Every interview registration for an Enrollment year, by S/N, with the
// filters as links. Drawn in the new shell (#328).
export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const supabase = await createClient()
  const asked = parseInterviewSearch(await searchParams)
  const years = await listInterviewYears(supabase)
  if (!years.ok) {
    return (
      <>
        <PageHeader title="Interviews" />
        <Unavailable />
      </>
    )
  }

  const currentYear = Number(tanzaniaToday().slice(0, 4))
  const search: InterviewListSearch = {
    ...asked,
    enrollmentYear: asked.enrollmentYear ?? defaultInterviewYear(years.data, currentYear),
  }
  const results = await listInterviews(supabase, search)
  // The Result sent column, for the interviews on this page.
  const statuses = results.ok
    ? await listReleaseStatus(
        supabase,
        results.data.interviews.map((interview) => interview.id),
      )
    : null
  // The year on show is offered even when it has no registrations, so the
  // year links always say which one is open.
  const offered = [...new Set([...years.data, search.enrollmentYear])].sort((a, b) => a - b)

  const groups = [
    {
      label: "Enrollment year",
      options: offered.map((year) => ({
        label: String(year),
        // The filters carry over, so Not Paid stays Not Paid in another year.
        href: interviewsHref(search, { enrollmentYear: year, page: 1 }),
        current: year === search.enrollmentYear,
      })),
    },
    {
      label: "Result",
      options: RESULT_FILTERS.map((filter) => ({
        label: filter.label,
        href: interviewsHref(search, { result: filter.value, page: 1 }),
        current: filter.value === search.result,
      })),
    },
    {
      label: "Interview fee",
      options: FEE_FILTERS.map((filter) => ({
        label: filter.label,
        href: interviewsHref(search, { feeStatus: filter.value, page: 1 }),
        current: filter.value === search.feeStatus,
      })),
    },
    {
      label: "Result release",
      options: RELEASE_FILTERS.map((filter) => ({
        label: filter.label,
        href: interviewsHref(search, { readyToSend: filter.value, page: 1 }),
        current: filter.value === search.readyToSend,
      })),
    },
  ]

  return (
    <>
      <PageHeader title="Interviews" />
      <div className="iv-stack">
        <div className="iv-filters">
          {groups.map((group) => (
            <div key={group.label} className="iv-filter">
              <p className="iv-filter-label" aria-hidden="true">
                {group.label}
              </p>
              <FilterPills
                label={group.label}
                options={group.options.map(({ label, href }) => ({ label, href }))}
                current={group.options.find((option) => option.current)?.href ?? null}
                className="iv-pills"
              />
            </div>
          ))}
        </div>

        {!results.ok || !statuses?.ok ? (
          <Unavailable />
        ) : (
          <Results results={results.data} statuses={statuses.data} search={search} />
        )}
      </div>
    </>
  )
}

function Unavailable() {
  return (
    <Note tone="bad" role="alert">
      Interviews could not be loaded. Try again in a moment.
    </Note>
  )
}

function Results({
  results,
  statuses,
  search,
}: {
  results: InterviewList
  statuses: Map<string, ReleaseStatus>
  search: InterviewListSearch
}) {
  const { total, page, pageCount } = results
  // Result, score and Result sent from the one status read (see rows.ts).
  const interviews = interviewRows(results.interviews, statuses)
  const filtered = search.result !== undefined || search.feeStatus !== undefined || search.readyToSend !== undefined
  const onlyReady = search.readyToSend && search.result === undefined && search.feeStatus === undefined
  const empty = onlyReady
    ? `No results for ${search.enrollmentYear} are waiting to be sent.`
    : filtered
      ? "No interviews match these filters."
      : `No one is registered for interview for ${search.enrollmentYear} yet.`

  const rows: InterviewTableRow[] = interviews.map((interview) => ({
    id: interview.id,
    serialNumber: interview.serialNumber,
    admissionNumber: interview.lead.admissionNumber,
    studentName: interview.lead.studentName,
    leadHref: leadTabHref(interview.lead.id, "interview", "lead-interview"),
    closed: interview.lead.closed ? { text: closedState(interview.lead), declined: interview.lead.status === "Declined" } : null,
    className: interview.lead.className,
    dayOrBoarding: interview.lead.dayOrBoarding,
    result: interview.result,
    score: interview.score,
    feeStatus: interview.feeStatus,
    sentOn: interview.sentOn,
  }))

  return (
    <section aria-label="Results" className="iv-stack">
      {total === 0 ? (
        <Card role="status">
          <EmptyState
            illustration={onlyReady ? "done" : "search"}
            title={empty}
            action={
              filtered && (
                <ButtonLink href={interviewsHref({ enrollmentYear: search.enrollmentYear, page: 1 })} variant="ghost">
                  Show every interview for {search.enrollmentYear}
                </ButtonLink>
              )
            }
          />
        </Card>
      ) : (
        <p className="iv-count" aria-live="polite">
          {`${total} ${total === 1 ? "interview" : "interviews"}`}
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <InterviewsTable label={`Interviews for ${search.enrollmentYear}`} rows={rows} />
        </Card>
      )}

      <Pagination
        label="Interview pages"
        page={page}
        pageCount={pageCount}
        href={(each) => interviewsHref(search, { page: each })}
        previousLabel="Previous page"
        nextLabel="Next page"
        pageLabel={(each) => `Page ${each}`}
      />
    </section>
  )
}
