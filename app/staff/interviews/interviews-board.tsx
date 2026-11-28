"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, type ReactNode } from "react"

import {
  Card,
  ColumnHeader,
  DateChoice,
  DatePanel,
  EmptyState,
  FilterChoices,
  FilterGroupsMenu,
  Highlight,
  ListFoot,
  PageHeader,
  SearchField,
  Select,
  Table,
  Tag,
  TextLink,
  type FilterChoice,
  type TableColumn,
} from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import type { InterviewFeeStatus } from "@/lib/services/interviews"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"

import {
  admissionMarks,
  interviewsHref,
  nameMarks,
  narrowed,
  nextSort,
  pageCount,
  pageOf,
  parseBoard,
  passes,
  searchTerms,
  sortRows,
  type BoardRow,
  type BoardState,
  type FilterKey,
  type InterviewResultFilter,
  type SentFilter,
  type SortKey,
} from "./board"
import { InterviewSheet } from "./interview-sheet"
import { recordFromInterviews } from "./record-link"
import "./interviews.css"
import { ResultTag } from "./result-tag"

const RESULT_CHOICES: { value: InterviewResultFilter; label: string }[] = [
  { value: "none", label: "No result yet" },
  { value: "Passed", label: "Passed" },
  { value: "Conditional", label: "Conditional" },
  { value: "Failed", label: "Failed" },
]
const FEE_CHOICES: { value: InterviewFeeStatus; label: string }[] = [
  { value: "Paid", label: "Paid" },
  { value: "Not Paid", label: "Not Paid" },
]
const SENT_CHOICES: { value: SentFilter; label: string }[] = [
  { value: "sent", label: "Sent" },
  { value: "not-sent", label: "Not sent" },
]

/**
 * The Interviews list (prototype 1MpUKuX27V6pc1CS1z1URz v5): the whole
 * enrollment year, searched, filtered, sorted and paged here as staff type.
 * The state is the address, written with replaceState, so nothing goes back to
 * the server until the year changes or a save refreshes the rows.
 */
export function InterviewsBoard({
  year,
  years,
  rows,
  today,
  canRecord,
  canMarkFee,
}: {
  year: number
  // Each year with its number of registrations, oldest first.
  years: { year: number; count: number }[]
  rows: BoardRow[]
  // Today in Tanzania, "YYYY-MM-DD".
  today: string
  canRecord: boolean
  canMarkFee: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const state = parseBoard(params)
  const terms = useMemo(() => searchTerms(state.q), [state.q])

  const set = (changes: Partial<BoardState>) => {
    // A new search or filter starts at the first page.
    const page = "page" in changes ? changes.page! : changes.open !== undefined || changes.sort !== undefined ? state.page : 1
    const next = { ...state, ...changes, page }
    window.history.replaceState(null, "", interviewsHref(year, next))
  }

  const shown = useMemo(() => sortRows(rows.filter((row) => passes(row, state, terms)), state.sort), [rows, state, terms])
  const { page, rows: pageRows, from } = pageOf(shown, state.page)
  const count = (key: FilterKey, test: (row: BoardRow) => boolean) => rows.filter((row) => passes(row, state, terms, key) && test(row)).length
  const present = LEAD_CLASSES.filter((name) => rows.some((row) => row.className === name))

  const choices = {
    classes: present.map((name): FilterChoice => ({ value: name, label: name, count: count("classes", (row) => row.className === name) })),
    result: RESULT_CHOICES.map((c): FilterChoice => ({ ...c, count: count("result", (row) => (c.value === "none" ? row.result === null : row.result === c.value)) })),
    fee: FEE_CHOICES.map((c): FilterChoice => ({ ...c, count: count("fee", (row) => row.feeStatus === c.value) })),
    sent: SENT_CHOICES.map((c): FilterChoice => ({ ...c, count: count("sent", (row) => (c.value === "sent") === (row.sentOn !== null)) })),
  }
  const setClasses = (value: string[]) => set({ classes: value as LeadClass[] })
  const setResult = (value: string) => set({ result: value as InterviewResultFilter | "" })
  const setFee = (value: string) => set({ fee: value as InterviewFeeStatus | "" })
  const setSent = (value: string) => set({ sent: value as SentFilter | "" })
  const clearFilters = () => set({ date: "", classes: [], result: "", fee: "", sent: "" })

  const on = [
    state.date && `Registered ${formatDate(state.date)}`,
    state.classes.length > 0 && [...state.classes].sort((a, b) => LEAD_CLASSES.indexOf(a) - LEAD_CLASSES.indexOf(b)).join(", "),
    state.result && RESULT_CHOICES.find((c) => c.value === state.result)?.label,
    state.fee,
    state.sent && `Result ${state.sent === "sent" ? "sent" : "not sent"}`,
  ].filter(Boolean) as string[]

  const sortOf = (key: SortKey) => (state.sort?.key === key ? state.sort.dir : null)
  const ariaSort = (key: SortKey) => {
    const dir = sortOf(key) ?? (state.sort === null && key === "sn" ? "desc" : null)
    return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined
  }
  const header = (label: string, key: SortKey, filter?: { on: boolean; wide?: boolean; draw: (close: () => void) => ReactNode }) => (
    <ColumnHeader
      label={label}
      sort={sortOf(key)}
      onSort={() => set({ sort: nextSort(state.sort, key) })}
      filter={filter?.draw}
      filterOn={filter?.on}
      filterWide={filter?.wide}
    />
  )

  const columns: TableColumn<BoardRow>[] = [
    { header: header("S/N", "sn"), ariaSort: ariaSort("sn"), cell: (row) => <span className="iv-sn">{row.serialNumber}</span> },
    {
      header: header("Registered", "registered", {
        on: state.date !== "",
        wide: true,
        draw: (close) => (
          <DatePanel
            value={state.date}
            today={today}
            onPick={(day) => {
              set({ date: day })
              close()
            }}
          />
        ),
      }),
      ariaSort: ariaSort("registered"),
      cell: (row) => <span className="iv-nowrap">{formatDate(row.registeredOn)}</span>,
    },
    { header: "Admission Number", cell: (row) => <span className="iv-nowrap"><Highlight text={row.admissionNumber} marks={admissionMarks(row.admissionNumber, terms)} /></span> },
    {
      header: "Student",
      rowHeader: true,
      cell: (row) => (
        <span className="iv-student">
          <span className="iv-name" data-closed={row.closed ? "" : undefined}>
            <Highlight text={row.studentName} marks={nameMarks(row.studentName, terms)} />
          </span>
          {row.closed && <Tag tone={row.closed.declined ? "bad" : "line"}>{row.closed.text}</Tag>}
        </span>
      ),
    },
    {
      header: header("Class", "class", {
        on: state.classes.length > 0,
        draw: () => <FilterChoices label="Class" many allLabel="All classes" options={choices.classes} value={state.classes} onChange={setClasses} />,
      }),
      ariaSort: ariaSort("class"),
      cell: (row) => <span className="iv-nowrap">{row.className}</span>,
    },
    {
      header: header("Result", "result", {
        on: state.result !== "",
        draw: (close) => <FilterChoices label="Result" options={choices.result} value={state.result} onChange={(v) => (setResult(v), close())} />,
      }),
      ariaSort: ariaSort("result"),
      cell: (row) => (row.result === null ? <span className="iv-quiet iv-nowrap">No result yet</span> : <ResultTag result={row.result} />),
    },
    {
      header: header("Score", "score"),
      ariaSort: ariaSort("score"),
      align: "end",
      cell: (row) => (row.score === null ? <span className="iv-quiet">–</span> : `${row.score}%`),
    },
    {
      header: header("Interview fee", "fee", {
        on: state.fee !== "",
        draw: (close) => <FilterChoices label="Interview fee" options={choices.fee} value={state.fee} onChange={(v) => (setFee(v), close())} />,
      }),
      ariaSort: ariaSort("fee"),
      cell: (row) => (
        <span data-column="fee">
          <Tag tone={row.feeStatus === "Paid" ? "ok" : "wait"}>{row.feeStatus}</Tag>
        </span>
      ),
    },
    {
      header: header("Result sent", "sent", {
        on: state.sent !== "",
        draw: (close) => <FilterChoices label="Result sent" options={choices.sent} value={state.sent} onChange={(v) => (setSent(v), close())} />,
      }),
      ariaSort: ariaSort("sent"),
      cell: (row) => (
        <span data-column="sent" className="iv-nowrap">
          {row.sentOn && formatDate(row.sentOn)}
        </span>
      ),
    },
  ]

  const open = state.open ? (rows.find((row) => row.id === state.open) ?? null) : null
  const matching = narrowed(state)
  const search = state.q.trim()

  return (
    <>
      <PageHeader title="Interviews" count={rows.length} countLabel={`${rows.length} ${rows.length === 1 ? "interview" : "interviews"} for ${year}`} />
      <div className="iv-stack">
        <div className="iv-toolbar">
          <SearchField
            value={state.q}
            onChange={(q) => set({ q })}
            label={`Search the ${year} interviews by name or Admission Number`}
            placeholder="Search a name or Admission Number"
            className="iv-search"
          />
          <Select
            aria-label="Enrollment year"
            prefix="Enrollment year"
            className="iv-year"
            value={String(year)}
            options={years.map((each) => ({ value: String(each.year), label: String(each.year), hint: `· ${each.count} ${each.count === 1 ? "interview" : "interviews"}` }))}
            onValueChange={(value) => router.push(interviewsHref(Number(value)))}
          />
          <DateChoice label="Registered on" value={state.date} onChange={(date) => set({ date })} formatDay={formatDate} today={today} />
          <FilterGroupsMenu
            onClear={clearFilters}
            groups={[
              { key: "class", label: "Class", many: true, look: "chips", options: choices.classes, value: state.classes, onChange: setClasses },
              { key: "result", label: "Result", options: choices.result, value: state.result, onChange: setResult },
              { key: "fee", label: "Interview fee", options: choices.fee, value: state.fee, onChange: setFee },
              { key: "sent", label: "Result sent", options: choices.sent, value: state.sent, onChange: setSent },
            ]}
          />
        </div>

        {on.length > 0 && (
          <p className="iv-fline">
            Filtered by <b>{on.join(" · ")}</b>
            <TextLink onClick={clearFilters}>Clear filters</TextLink>
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {matching ? `${shown.length} ${shown.length === 1 ? "match" : "matches"}` : ""}
        </p>

        {shown.length === 0 ? (
          <Card role="status">
            <EmptyState
              illustration="search"
              title={
                rows.length === 0
                  ? `No one is registered for interview for ${year} yet.`
                  : search
                    ? `No one matching “${search}” is on the ${year} list${on.length ? " with these filters" : ""}.`
                    : "No interviews match these filters."
              }
              hint={rows.length > 0 && search ? "Check the spelling, or search by the Admission Number." : undefined}
              action={
                rows.length > 0 && (
                  <span className="iv-acts">
                    {search && <TextLink onClick={() => set({ q: "" })}>Clear the search</TextLink>}
                    {on.length > 0 && <TextLink onClick={clearFilters}>Clear filters</TextLink>}
                  </span>
                )
              }
            />
          </Card>
        ) : (
          <>
            <Card>
              <Table
                label={`Interviews for ${year}`}
                columns={columns}
                rows={pageRows}
                rowKey={(row) => row.id}
                onOpen={(row) => set({ open: row.id })}
                rowLabel={(row) => `${row.studentName}, S/N ${row.serialNumber}: open the interview`}
              />
            </Card>
            <ListFoot
              summary={
                <>
                  Showing{" "}
                  <b>
                    {from + 1}–{from + pageRows.length}
                  </b>{" "}
                  of <b>{shown.length}</b> {matching ? `matching ${shown.length === 1 ? "interview" : "interviews"}` : shown.length === 1 ? "interview" : "interviews"}
                </>
              }
              pagination={{
                label: "Interview pages",
                page,
                pageCount: pageCount(shown.length),
                onPage: (each) => {
                  set({ page: each })
                  document.querySelector("[data-stage-scroll]")?.scrollTo({ top: 0 })
                },
                previousLabel: "Previous page",
                nextLabel: "Next page",
                pageLabel: (each) => `Page ${each}`,
              }}
            />
          </>
        )}
      </div>

      <InterviewSheet
        row={open}
        canRecord={canRecord}
        canMarkFee={canMarkFee}
        fullRecordHref={(row) => recordFromInterviews(row.leadId, interviewsHref(year, { ...state, open: null }))}
        onClose={() => set({ open: null })}
      />
    </>
  )
}
