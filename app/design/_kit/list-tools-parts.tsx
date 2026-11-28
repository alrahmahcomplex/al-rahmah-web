"use client"

import { useState } from "react"

import {
  Card,
  ColumnHeader,
  DateChoice,
  FilterChoices,
  FilterGroupsMenu,
  Highlight,
  ListFoot,
  SearchField,
  Select,
  Table,
  type SortDirection,
} from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"

// The tools of a long list (Interviews revamp, prototype
// 1MpUKuX27V6pc1CS1z1URz v5), built in components/kit/list-tools.tsx and shown
// here before a screen uses them (DESIGN.md, The Kit First Rule). Fixture data only.

const CLASSES = [
  { value: "KG 1", label: "KG 1", count: 9 },
  { value: "KG 2", label: "KG 2", count: 14 },
  { value: "STD 1", label: "STD 1", count: 11 },
  { value: "STD 3", label: "STD 3", count: 14 },
  { value: "FORM 1", label: "FORM 1", count: 12 },
]
const RESULTS = [
  { value: "none", label: "No result yet", count: 51 },
  { value: "Passed", label: "Passed", count: 55 },
  { value: "Conditional", label: "Conditional", count: 16 },
  { value: "Failed", label: "Failed", count: 20 },
]

export function SearchFieldCard() {
  const [q, setQ] = useState("ami")
  return (
    <Card id="search-field" title="Search field with Clear">
      <SearchField value={q} onChange={setQ} label="Search the example list" placeholder="Search a name or Admission Number" />
      <p className="kp-spec">
        The compact field with the search icon. The list changes on every letter, with no Search button; the round × shows once
        something is typed, and it and Escape clear the field and keep the cursor in it.
      </p>
    </Card>
  )
}

export function SearchMatchCard() {
  return (
    <Card id="search-match" title="Search match">
      <p className="kp-rowx">
        <span className="kp-name">
          <Highlight text="Amina Juma Mrisho" marks={[[0, 3]]} />
        </span>
        <span className="kp-name">
          <Highlight text="Said Amani Ngowi" marks={[[5, 7]]} />
        </span>
        <span>
          <Highlight text="ADMSN-00142" marks={[[8, 11]]} />
        </span>
      </p>
      <p className="kp-spec">The letters a search matched, in Orange Tint with Sunrise Deep text. Only what matched is marked, never the whole name.</p>
    </Card>
  )
}

export function DateChoiceCard() {
  const today = tanzaniaToday()
  const [day, setDay] = useState("")
  const [picked, setPicked] = useState(today)
  return (
    <Card id="date-choice" title="Date choice">
      <div className="kp-rowx">
        <DateChoice label="Registered on" value={day} onChange={setDay} formatDay={formatDate} today={today} />
        <DateChoice label="Registered on" value={picked} onChange={setPicked} formatDay={formatDate} today={today} />
      </div>
      <p className="kp-spec">
        The Select&apos;s 44px pill with the calendar icon, opening the kit&apos;s month calendar with Any date and Today at its foot.
        A picked day turns the pill Lavender Whisper with the indigo line, as a filter that is on. One day at a time.
      </p>
    </Card>
  )
}

type DemoRow = { id: string; sn: number; name: string; className: string; score: number | null }
const DEMO: DemoRow[] = [
  { id: "a", sn: 142, name: "Elia Juma Nyoni", className: "FORM 3", score: null },
  { id: "b", sn: 141, name: "Rajabu Juma Kassim", className: "DAY CARE", score: 64 },
  { id: "c", sn: 140, name: "Idrisa Juma Kibwana", className: "FORM 1", score: 82 },
]

export function ColumnHeaderCard() {
  const [sort, setSort] = useState<{ key: "sn" | "score"; dir: SortDirection } | null>(null)
  const [classes, setClasses] = useState<string[]>([])
  const press = (key: "sn" | "score") => setSort((now) => (!now || now.key !== key ? { key, dir: "asc" } : now.dir === "asc" ? { key, dir: "desc" } : null))
  const dir = (key: "sn" | "score") => (sort?.key === key ? sort.dir : null)
  const rows = DEMO.filter((row) => classes.length === 0 || classes.includes(row.className)).sort((a, b) => {
    if (!sort) return b.sn - a.sn
    const sign = sort.dir === "asc" ? 1 : -1
    const x = sort.key === "sn" ? a.sn : (a.score ?? Infinity)
    const y = sort.key === "sn" ? b.sn : (b.score ?? Infinity)
    return x === y ? 0 : (x < y ? -1 : 1) * sign
  })
  return (
    <Card id="column-header" title="Sortable column heading" data-bento="full">
      <Table
        label="Example list"
        rowKey={(row) => row.id}
        rows={rows}
        columns={[
          { header: <ColumnHeader label="S/N" sort={dir("sn")} onSort={() => press("sn")} />, ariaSort: dir("sn") === "asc" ? "ascending" : dir("sn") === "desc" || !sort ? "descending" : undefined, cell: (row) => <b>{row.sn}</b> },
          { header: "Student", rowHeader: true, cell: (row) => row.name },
          {
            header: (
              <ColumnHeader
                label="Class"
                filterOn={classes.length > 0}
                filter={() => <FilterChoices label="Class" many allLabel="All classes" options={CLASSES.map((c) => ({ ...c, count: undefined }))} value={classes} onChange={setClasses} />}
              />
            ),
            cell: (row) => row.className,
          },
          {
            header: <ColumnHeader label="Score" sort={dir("score")} onSort={() => press("score")} />,
            ariaSort: dir("score") === "asc" ? "ascending" : dir("score") === "desc" ? "descending" : undefined,
            align: "end",
            cell: (row) => (row.score === null ? "–" : `${row.score}%`),
          },
        ]}
      />
      <p className="kp-spec">
        After a sortable name, two small chevrons, both faint until pressed. First press: lowest first, ˄ bright. Second: highest
        first, ˅ bright. Third: back to the page&apos;s own order. A name with a dotted line opens that column&apos;s filter; an orange
        dot follows it while the filter is on. The column carries aria-sort.
      </p>
    </Card>
  )
}

export function FilterGroupsCard() {
  const [classes, setClasses] = useState<string[]>(["KG 1"])
  const [result, setResult] = useState("")
  return (
    <Card id="filter-groups" title="Filter button with groups">
      <div className="kp-rowx">
        <FilterGroupsMenu
          onClear={() => {
            setClasses([])
            setResult("")
          }}
          groups={[
            { key: "class", label: "Class", many: true, look: "chips", options: CLASSES, value: classes, onChange: setClasses },
            { key: "result", label: "Result", options: RESULTS, value: result, onChange: setResult },
          ]}
        />
        <p className="kp-spec">
          On: <b>{[classes.join(", "), RESULTS.find((r) => r.value === result)?.label].filter(Boolean).join(" · ") || "nothing"}</b>
        </p>
      </div>
      <p className="kp-spec">
        The 40px Filter button with the orange dot while any filter is on. Each group under its name: rows with counts for one
        choice, chips you turn on and off for several. Clear filters and Done at the foot; a choice applies at once.
      </p>
    </Card>
  )
}

export function ListFootCard() {
  const [page, setPage] = useState(1)
  return (
    <Card id="list-foot" title="List foot">
      <ListFoot
        summary={
          <>
            Showing <b>{(page - 1) * 50 + 1}–{Math.min(page * 50, 142)}</b> of <b>142</b> interviews
          </>
        }
        pagination={{ label: "Example pages", page, pageCount: 3, onPage: setPage, previousLabel: "Previous page", nextLabel: "Next page", pageLabel: (each) => `Page ${each}` }}
      />
      <p className="kp-spec">How many the list shows, then the kit&apos;s page numbers. With a search or a filter on it counts the matches.</p>
    </Card>
  )
}

export function ListToolbarCard() {
  const today = tanzaniaToday()
  const [q, setQ] = useState("")
  const [year, setYear] = useState("2027")
  const [day, setDay] = useState("")
  return (
    <Card id="list-toolbar" title="List toolbar" data-bento="full">
      <div className="kp-toolbar">
        <SearchField value={q} onChange={setQ} label="Search the example list" placeholder="Search a name or Admission Number" className="kp-grow" />
        <Select
          aria-label="Enrollment year"
          prefix="Enrollment year"
          value={year}
          onValueChange={setYear}
          className="kp-year"
          options={[
            { value: "2026", label: "2026", hint: "· 4 interviews" },
            { value: "2027", label: "2027", hint: "· 142 interviews" },
            { value: "2028", label: "2028", hint: "· 2 interviews" },
          ]}
        />
        <DateChoice label="Registered on" value={day} onChange={setDay} formatDay={formatDate} today={today} />
        <FilterGroupsMenu onClear={() => {}} groups={[{ key: "result", label: "Result", options: RESULTS, value: "", onChange: () => {} }]} />
      </div>
      <p className="kp-spec">
        One row, edge to edge: the search field takes the room the others leave. The Select can name itself inside the pill
        (<code>prefix</code>) and add a quiet note to each choice in its list (<code>hint</code>). On a phone the search takes the
        first line and the pill shows the value alone.
      </p>
    </Card>
  )
}
