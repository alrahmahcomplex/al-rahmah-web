import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { InterviewFeeStatus } from "@/lib/services/interviews"
import {
  listInterviews,
  listInterviewYears,
  type InterviewList,
  type InterviewListSearch,
  type InterviewResultFilter,
} from "@/lib/services/interview-list"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { closedState } from "../leads/[id]/closed-state"
import { requireStaff } from "../session"
import { defaultInterviewYear, interviewsHref, parseInterviewSearch } from "./search-params"

export const metadata: Metadata = {
  title: "Interviews · Al-Rahmah Complex",
}

// Each filter group is a row of links, so a filter is a URL. Slice 6 adds its
// Ready to send group here.
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
  if (!years.ok) return <Unavailable />

  const currentYear = Number(tanzaniaToday().slice(0, 4))
  const search: InterviewListSearch = {
    ...asked,
    enrollmentYear: asked.enrollmentYear ?? defaultInterviewYear(years.data, currentYear),
  }
  const results = await listInterviews(supabase, search)
  // The year on show is offered even when it has no registrations, so the
  // year links always say which one is open.
  const offered = [...new Set([...years.data, search.enrollmentYear])].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Interviews</h1>

      <div className="flex flex-col gap-3">
        <FilterGroup
          label="Enrollment year"
          options={offered.map((year) => ({
            label: String(year),
            // The filters carry over, so Not Paid stays Not Paid in another year.
            href: interviewsHref(search, { enrollmentYear: year, page: 1 }),
            current: year === search.enrollmentYear,
          }))}
        />
        <FilterGroup
          label="Result"
          options={RESULT_FILTERS.map((filter) => ({
            label: filter.label,
            href: interviewsHref(search, { result: filter.value, page: 1 }),
            current: filter.value === search.result,
          }))}
        />
        <FilterGroup
          label="Interview fee"
          options={FEE_FILTERS.map((filter) => ({
            label: filter.label,
            href: interviewsHref(search, { feeStatus: filter.value, page: 1 }),
            current: filter.value === search.feeStatus,
          }))}
        />
      </div>

      {!results.ok ? <Unavailable /> : <Results results={results.data} search={search} />}
    </div>
  )
}

function Unavailable() {
  return (
    <Alert variant="destructive">
      <AlertDescription>Interviews could not be loaded. Try again in a moment.</AlertDescription>
    </Alert>
  )
}

function FilterGroup({ label, options }: { label: string; options: { label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <p className="w-32 shrink-0 text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Link
            key={option.href}
            href={option.href}
            aria-current={option.current ? "page" : undefined}
            className={buttonVariants({ variant: option.current ? "default" : "outline", size: "sm" })}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

function Results({ results, search }: { results: InterviewList; search: InterviewListSearch }) {
  const { interviews, total, page, pageCount } = results
  const filtered = search.result !== undefined || search.feeStatus !== undefined
  const empty = filtered
    ? "No interviews match these filters."
    : `No one is registered for interview for ${search.enrollmentYear} yet.`

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? empty : `${total} ${total === 1 ? "interview" : "interviews"}`}
        {total === 0 && filtered && (
          <>
            {" "}
            <Link
              href={interviewsHref({ enrollmentYear: search.enrollmentYear, page: 1 })}
              className="font-medium text-slate-900 underline underline-offset-4"
            >
              Show every interview for {search.enrollmentYear}
            </Link>
          </>
        )}
      </p>

      {interviews.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label={`Interviews for ${search.enrollmentYear}`} className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">S/N</th>
                <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">Class</th>
                <th scope="col" className="px-3 py-2 font-medium">Day or boarding</th>
                <th scope="col" className="px-3 py-2 font-medium">Result</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                <th scope="col" className="px-3 py-2 font-medium">Interview fee</th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((interview) => (
                <tr key={interview.id} className="border-b align-top last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-900">{interview.serialNumber}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{interview.lead.admissionNumber}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/staff/leads/${interview.lead.id}`}
                        className={cn(
                          "font-medium underline-offset-4 hover:underline",
                          interview.lead.closed ? "text-muted-foreground" : "text-slate-900",
                        )}
                      >
                        {interview.lead.studentName}
                      </Link>
                      {interview.lead.closed && (
                        <Badge variant={interview.lead.status === "Declined" ? "destructive" : "outline"}>
                          {closedState(interview.lead)}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{interview.lead.className}</td>
                  <td className="px-3 py-2">{interview.lead.dayOrBoarding}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {interview.result === null ? (
                      <span className="text-muted-foreground">No result yet</span>
                    ) : (
                      <span className={cn("font-medium", interview.result === "Passed" ? "text-emerald-700" : "text-slate-900")}>
                        {interview.result}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {interview.score === null ? <span className="text-muted-foreground">–</span> : `${interview.score}%`}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={interview.feeStatus === "Paid" ? "secondary" : "outline"}
                      className={cn(interview.feeStatus === "Paid" && "bg-emerald-50 text-emerald-800")}
                    >
                      {interview.feeStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3">
          {page > 1 ? (
            <Link href={interviewsHref(search, { page: page - 1 })} className={buttonVariants({ variant: "outline" })}>
              Previous
            </Link>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <Link href={interviewsHref(search, { page: page + 1 })} className={buttonVariants({ variant: "outline" })}>
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  )
}
