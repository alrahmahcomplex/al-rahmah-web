"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { EmptyState, FilterPills, Pagination, Select, StatusChip, Table, Tag, type TableColumn } from "@/components/kit"
import { LEAD_STATUSES, type ClosureFilter, type LeadListItem, type LeadSearch, type LeadSearchResults, type LeadStatus } from "@/lib/services/leads"
import type { SeatPriority } from "@/lib/services/school-fee-payments"

import { SeatPriorityTag } from "./[id]/seat-priority-tag"
import { ApplicantSheet, type SheetApplicant } from "./applicant-sheet"
import { leadsHref } from "./search-params"
import { loadApplicantSheet } from "./sheet-actions"
import type { ApplicantSheetAnswer } from "./sheet-view"

const ALL = "All"

const CLOSURE_LABELS: Record<ClosureFilter, string> = {
  open: "Without a closure mark",
  Inactive: "Inactive",
  Archived: "Archived",
  all: "All applicants",
}

const EMPTY: Record<LeadSearchResults["mode"], string> = {
  number: "No applicant with this Admission Number.",
  name: "No applicant matches this name.",
  list: "No applicants to show with these filters.",
}

const LOST: ApplicantSheetAnswer = { status: "failed" }

type Search = LeadSearch & { closure: ClosureFilter }

/**
 * The Applicants card (prototype v38): the status pills, the closure and
 * group-invitation filters, the search or import chip with Clear, the table
 * and its pages. Everything lives in the URL, so a list can be shared and
 * Back undoes a filter; a filter starts again from the first page and leaves
 * a search. While a search is shown the filters don't apply, so no pill is
 * pressed and the two lists are hidden; Clear brings back the filtered list.
 * A row opens the side sheet.
 */
export function ApplicantsList({
  results,
  search,
  groupYears,
  priorities,
  importLabel,
}: {
  results: LeadSearchResults
  search: Search
  // Enrollment years with a saved WhatsApp group link, for the earlier-link filter.
  groupYears: number[]
  // Seat priority by lead id; null hides the column.
  priorities: Record<string, SeatPriority> | null
  // What the import chip says, while the list shows one import's applicants.
  importLabel: string | null
}) {
  const router = useRouter()
  const { leads, total, page, pageCount, mode } = results
  const searching = mode !== "list"

  // The filters as last chosen, not as `search` has them: a second change made
  // before the first one's page arrives would otherwise undo it. They follow
  // the URL again whenever its page arrives (and on Back and Forward).
  const shownHref = leadsHref(search)
  const [chosen, setChosen] = useState({ status: search.status, closure: search.closure, earlierLinkYear: search.earlierLinkYear })
  const [chosenFor, setChosenFor] = useState(shownHref)
  if (chosenFor !== shownHref) {
    setChosenFor(shownHref)
    setChosen({ status: search.status, closure: search.closure, earlierLinkYear: search.earlierLinkYear })
  }
  function filter(changes: Partial<Pick<LeadSearch, "status" | "closure" | "earlierLinkYear">>) {
    const next = { ...chosen, ...changes }
    setChosen(next)
    router.push(leadsHref({ ...next, importBatchId: search.importBatchId, page: 1 }))
  }

  // A year from the URL with no saved link still shows, so the list says
  // what the page is showing.
  const linkYears =
    search.earlierLinkYear !== undefined && !groupYears.includes(search.earlierLinkYear)
      ? [...groupYears, search.earlierLinkYear].sort((a, b) => a - b)
      : groupYears

  const [sheet, setSheet] = useState<{ applicant: SheetApplicant; answer: ApplicantSheetAnswer | null } | null>(null)
  const [open, setOpen] = useState(false)
  const asked = useRef(0)

  async function openRow(lead: LeadListItem) {
    const ask = ++asked.current
    setSheet({ applicant: lead, answer: null })
    setOpen(true)
    let answer: ApplicantSheetAnswer
    try {
      answer = await loadApplicantSheet(lead.id)
    } catch {
      answer = LOST
    }
    // A later row's answer wins.
    if (ask === asked.current) setSheet({ applicant: lead, answer })
  }

  const columns: TableColumn<LeadListItem>[] = [
    {
      header: "Student",
      rowHeader: true,
      cell: (lead) => (
        <span className="ap-who">
          <b>{lead.studentName}</b>
          <small className="kit-num">{lead.admissionNumber}</small>
        </span>
      ),
    },
    { header: "Class", cell: (lead) => <span className="ap-nowrap">{lead.className}</span> },
    { header: "Custodian", cell: (lead) => lead.custodianName ?? "" },
    {
      header: "Status",
      cell: (lead) => (
        <span className="ap-chips">
          <StatusChip status={lead.status} />
          {lead.closure && <StatusChip status={lead.closure} />}
          {lead.initiallyDeclined && <Tag tone="line">Initially declined</Tag>}
          {lead.returningFamily && <Tag tone="line">Returning family</Tag>}
          {lead.imported && <Tag tone="line">Imported</Tag>}
        </span>
      ),
    },
    ...(priorities
      ? [
          {
            header: "Seat priority",
            cell: (lead: LeadListItem) => (priorities[lead.id] ? <SeatPriorityTag priority={priorities[lead.id]} /> : null),
          },
        ]
      : []),
  ]

  const chip = searching ? `Search: ${search.query}` : importLabel
  const clearHref = searching ? leadsHref(search, { query: undefined, page: 1 }) : leadsHref(search, { importBatchId: undefined, page: 1 })
  const filtered = !searching && (search.status !== undefined || search.closure !== "open" || search.earlierLinkYear !== undefined || !!search.importBatchId)

  return (
    <>
      <div className="ap-tools">
        <FilterPills
          label="Filter by status"
          className="ap-pills"
          options={[ALL, ...LEAD_STATUSES].map((status) => ({ value: status, label: status }))}
          value={searching ? "" : (chosen.status ?? ALL)}
          onChange={(value) => filter({ status: value === ALL ? undefined : (value as LeadStatus) })}
        />
        {!searching && (
          <div className="ap-selects">
            <Select
              aria-label="Closure"
              value={chosen.closure ?? "open"}
              onValueChange={(value) => filter({ closure: value as ClosureFilter })}
              options={(Object.keys(CLOSURE_LABELS) as ClosureFilter[]).map((closure) => ({ value: closure, label: CLOSURE_LABELS[closure] }))}
            />
            {linkYears.length > 0 && (
              <Select
                aria-label="Group invitation"
                value={chosen.earlierLinkYear === undefined ? "" : String(chosen.earlierLinkYear)}
                onValueChange={(value) => filter({ earlierLinkYear: value ? Number(value) : undefined })}
                options={[
                  { value: "", label: "Any group invitation" },
                  ...linkYears.map((year) => ({ value: String(year), label: `Invitation sent with an earlier link, ${year}` })),
                ]}
              />
            )}
          </div>
        )}
        {chip && (
          <span className="ap-chip-row">
            <Tag tone="line" className="ap-chip">
              {chip}
            </Tag>
            <Link href={clearHref} className="kit-link">
              Clear
            </Link>
          </span>
        )}
      </div>

      {total > 0 && (
        <p className="ap-count" aria-live="polite">
          {mode === "list" ? `${total} ${total === 1 ? "applicant" : "applicants"}` : `${total} ${total === 1 ? "match" : "matches"}`}
        </p>
      )}

      {leads.length > 0 && (
        <Table
          label="Applicants"
          columns={columns}
          rows={leads}
          rowKey={(lead) => lead.id}
          onOpen={openRow}
          rowLabel={(lead) => `${lead.studentName}, ${lead.admissionNumber}`}
        />
      )}
      {total === 0 && (
        <div role="status">
          <EmptyState title={EMPTY[mode]} hint={filtered ? "Clear the filter to see everyone." : undefined} />
        </div>
      )}

      <Pagination
        className="ap-pages"
        label="Applicant pages"
        page={page}
        pageCount={pageCount}
        href={(each) => leadsHref(search, { page: each })}
        previousLabel="Previous page"
        nextLabel="Next page"
        pageLabel={(each) => `Page ${each}`}
      />

      <ApplicantSheet applicant={sheet?.applicant ?? null} answer={sheet?.answer ?? null} open={open} onOpenChange={setOpen} />
    </>
  )
}
