import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Card, FilterMenu, ListRow, Note, PageHeader, pageTitle, type FilterMenuOption } from "@/components/kit"
import { getLanguage } from "@/lib/language"
import { getAgentStudents, type AgentStudentStatus } from "@/lib/services/agent-students"
import { createClient } from "@/utils/supabase/server"

import { AGENTS_COPY, MAX_SHOWN, PAGE_SIZE, PROGRESS_STEPS, shownFrom, stepFrom, STUDENTS_COPY } from "../copy"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: pageTitle(AGENTS_COPY[language].navStudents) }
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const ALL_STEPS: readonly AgentStudentStatus[] = [...PROGRESS_STEPS, "Declined"]

function studentsHref(params: { q?: string | null; step?: AgentStudentStatus | null; n?: number | null }) {
  const next = new URLSearchParams()
  if (params.q) next.set("q", params.q)
  if (params.step) next.set("step", params.step)
  if (params.n) next.set("n", String(params.n))
  const text = next.toString()
  return text ? `/students?${text}` : "/students"
}

export default async function AgentsStudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const [language, params, supabase] = await Promise.all([getLanguage(), searchParams, createClient()])
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100) : ""
  const step = stepFrom(params.step)
  const shown = shownFrom(params.n)

  const list = await getAgentStudents(supabase, { search, limit: shown, offset: 0, step })
  if (!list.ok && list.error === "not-agent") redirect("/auth?from=home")
  if (!list.ok || list.data.kind !== "active") redirect("/home")

  const { total, matched, students, steps } = list.data
  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]

  if (total === 0) {
    return (
      <>
        <PageHeader title={copy.navStudents} />
        <Note>{studentsCopy.emptyNote}</Note>
      </>
    )
  }

  const currentLabel = step ? studentsCopy.statuses[step] : studentsCopy.all
  const filterOptions: FilterMenuOption[] = [
    {
      value: "all",
      label: studentsCopy.all,
      count: total,
      href: studentsHref({ q: search || null, step: null }),
    },
    ...ALL_STEPS.map((status) => ({
      value: status,
      label: studentsCopy.statuses[status],
      count: steps[status],
      href: studentsHref({ q: search || null, step: status }),
      disabled: steps[status] === 0 && step !== status,
    })),
  ]

  return (
    <>
      <PageHeader
        className="ag-ph"
        title={copy.navStudents}
        subtitle={
          <span className="ag-sub">
            {search ? (
              <>
                <span>
                  {copy.resultsFor(search)} · {matched}
                </span>
                <Link href={studentsHref({ step })} className="kit-link">
                  {studentsCopy.showAll}
                </Link>
              </>
            ) : (
              <span>
                {currentLabel} · {matched}
              </span>
            )}
          </span>
        }
        actions={
          <FilterMenu
            label={copy.filter}
            currentLabel={currentLabel}
            value={step ?? "all"}
            active={step !== null}
            options={filterOptions}
          />
        }
      />

      <Card className="ag-list-card">
        {matched === 0 ? (
          <p className="ag-empty-line">{studentsCopy.noMatch}</p>
        ) : (
          students.map((student) => (
            <ListRow
              key={student.id}
              inset
              title={student.name}
              caption={
                <>
                  {student.className} ·{" "}
                  <span
                    className="ag-stt"
                    data-tone={student.status === "Enrolled" ? "enrolled" : student.status === "Declined" ? "declined" : undefined}
                  >
                    {studentsCopy.statuses[student.status]}
                  </span>
                  {student.notActive && ` · ${studentsCopy.notActive}`}
                </>
              }
              href={`/students/${student.id}`}
            />
          ))
        )}

        {matched > students.length && shown < MAX_SHOWN && (
          <Link
            href={studentsHref({ q: search || null, step, n: shown + PAGE_SIZE })}
            scroll={false}
            className="kit-btn kit-ghost ag-more"
          >
            {studentsCopy.more}
          </Link>
        )}
        {matched > students.length && shown >= MAX_SHOWN && <p className="ag-empty-line">{studentsCopy.searchForMore}</p>}
      </Card>
    </>
  )
}
