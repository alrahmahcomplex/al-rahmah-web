import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { ButtonLink, Card, Note, PageHeader, pageTitle } from "@/components/kit"
import { nextStep, nextStepText } from "@/lib/lead-next-step"
import { enrollmentYears, formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { listNextStepFacts } from "@/lib/services/lead-next-steps"
import { listGroupLinks } from "@/lib/services/group-links"
import { searchLeads } from "@/lib/services/leads"
import { listSeatPriorities } from "@/lib/services/school-fee-payments"
import { getStudentImport } from "@/lib/services/student-import"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { ApplicantsList } from "./applicants-list"
import "./applicants.css"
import { exportOptions } from "./export/options"
import { ExportSheet } from "./export-sheet"
import { ImportSheet } from "./import-sheet"
import { parseLeadSearch } from "./search-params"

export const metadata: Metadata = {
  title: pageTitle("Applicants"),
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// Every applicant, from Applied to Enrolled, in the new shell (#324,
// prototype v38). The top bar's search searches here; a row opens the side
// sheet, which links to the full record.
export default async function ApplicantsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const search = parseLeadSearch(await searchParams)
  const supabase = await createClient()
  const [results, groupLinks, batch] = await Promise.all([
    searchLeads(supabase, search),
    listGroupLinks(supabase),
    search.importBatchId ? getStudentImport(supabase, search.importBatchId) : null,
  ])
  // Only the earlier-link filter's choices: without them it isn't offered.
  const groupYears = groupLinks.ok ? groupLinks.data.map((link) => link.year) : []
  // Seat priorities need payments.view. They and the next steps only
  // decorate the rows, so if they can't be read the list still shows,
  // without the column. The next steps of the whole page come in one read.
  const leadIds = results.ok ? results.data.leads.map((lead) => lead.id) : []
  const [priorities, facts] = results.ok
    ? await Promise.all([
        staff.permissions.includes("payments.view") ? listSeatPriorities(supabase, leadIds) : null,
        listNextStepFacts(supabase, leadIds),
      ])
    : [null, null]
  // The words the side sheet uses, by lead id. A closed lead has none: the
  // record shows its closed banner instead.
  const today = tanzaniaToday()
  const nextSteps = facts?.ok
    ? Object.fromEntries(
        [...facts.data].map(([id, each]) => {
          const step = nextStep({ ...each, today })
          return [id, step.kind === "closed" ? null : nextStepText(step, formatDate).title]
        }),
      )
    : null

  const listSearch = { query: search.query, status: search.status, closure: search.closure, earlierLinkYear: search.earlierLinkYear, importBatchId: search.importBatchId }
  // Starting a registration needs both permissions, as the database does.
  const canRegister = staff.permissions.includes("leads.create") && staff.permissions.includes("visits.record")
  const importLabel = !search.importBatchId
    ? null
    : batch?.ok && batch.data
      ? `Applicants created by the import of ${batch.data.fileName} on ${WHEN.format(new Date(batch.data.importedAt))}${batch.data.importedBy ? ` by ${batch.data.importedBy}` : ""}`
      : "Applicants created by an import that can't be found"

  return (
    <>
      <PageHeader
        title="Applicants"
        subtitle="Every student, from Applied to Enrolled."
        actions={
          <>
            {staff.permissions.includes("leads.import") && <ImportSheet staffName={staff.name} />}
            <ExportSheet
              options={exportOptions(staff)}
              search={listSearch}
              shownCount={results.ok ? results.data.total : null}
              years={enrollmentYears()}
            />
            {canRegister && (
              <ButtonLink href="/staff/check-in/new" size="small" chevron>
                Register students
              </ButtonLink>
            )}
          </>
        }
      />

      {!results.ok ? (
        <Note tone="bad" role="alert">
          Applicants could not be loaded. Try again in a moment.
        </Note>
      ) : (
        <div className="ap-page">
          {/* The list still works without the column, but staff are told it's missing. */}
          {priorities && !priorities.ok && (
            <Note tone="bad" role="alert">
              Seat priority could not be loaded, so it isn&apos;t shown. Try again in a moment.
            </Note>
          )}
          {facts && !facts.ok && (
            <Note tone="bad" role="alert">
              The next step could not be worked out. Try again in a moment.
            </Note>
          )}
          <Card aria-label="Results">
            <ApplicantsList
              results={results.data}
              search={search}
              groupYears={groupYears}
              priorities={
                priorities?.ok ? Object.fromEntries(Object.entries(priorities.data).map(([id, each]) => [id, each.priority])) : null
              }
              nextSteps={nextSteps}
              importLabel={importLabel}
            />
          </Card>
        </div>
      )}
    </>
  )
}
