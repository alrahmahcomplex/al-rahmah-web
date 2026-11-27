"use client"

import { useSearchParams } from "next/navigation"
import { createContext, Suspense, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

import { ChangeLink, GuidedHead, Icon as GuidedIcon, OfferPill, SummaryRow } from "@/components/guided-form"
import { ProgressBar, type ProgressGroup } from "@/components/guided-form/progress-bar"
import { Icon, ICONS, type IconName } from "@/components/icons"
import { Illustration, type IllustrationName } from "@/components/illustrations"
import {
  Bento,
  Button,
  ButtonLink,
  Card,
  ChipButtons,
  ChoiceTiles,
  ClassPicker,
  CodeBlock,
  DefaultTile,
  EmptyState,
  Field,
  FieldError,
  FilterPills,
  FinishedState,
  KeyValueList,
  ListRow,
  LoadingState,
  NamedField,
  Note,
  PageHeader,
  PasswordField,
  RoundButton,
  Section,
  SkeletonBlock,
  StatCard,
  StatusChip,
  Table,
  Tag,
  TaskCard,
  TextLink,
} from "@/components/kit"
import { useDesignHref } from "@/app/design/design-href"
import { usePartSearch } from "@/app/design/part-search"
import { PART_GROUPS, partsIn, type Part, type PartGroup } from "@/lib/design-site/catalog"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { LeadStatus } from "@/lib/services/leads"

import { CodeChipCard, FilterMenuCard, LinkRowsCard, ProfileRowCard, StepTrackCard, TopBarSwapCard } from "./agent-parts"
import { APPLICANTS, CAMPUS, DISCOUNT_REQUESTS, FEE_SCHEDULE, FILTERS, PAYMENT_KINDS, type Applicant } from "./fixtures"
import { FormPartsCard, ListInPopoverCard } from "./form-parts"
import { GuidedDemo } from "./guided-demo"
import "./kit-page.css"
import { FinishCard, PopoverCard, SheetCard, SideSheetCard, ToastCard } from "./overlays"
import { AccordionCard, AvatarsCard, ConfirmationNumberCard, NamesCard, PaginationCard, SignUpPartsCard, SliderCard, TabsCard, TimelineCard, TooltipsCard } from "./picked-parts"
import { ChipUpBarCard, LastNameCard, PlaceListsCard, TwoChoicesCard } from "./place-parts"

// The approved prototype's "Design system" page (version 13), rebuilt with
// the kit, then the kit's other pieces, filled with the prototype's own
// example data. Since the design site (prototype v6) the cards sit in the
// groups of lib/design-site/catalog.ts, each card's id its part's, so the
// sidebar's sections can jump to it. Fixture text only. The page is static:
// the date and the ?tab= and ?filter= links are read in the browser.

const ICON_NAMES = Object.keys(ICONS) as IconName[]

const SWATCHES = [
  ["Rahmah Indigo", "--gf-indigo"],
  ["Indigo Night", "--gf-indigo-night"],
  ["Lavender Mist", "--gf-mist"],
  ["Lavender Whisper", "--gf-whisper"],
  ["Sunrise Orange", "--gf-orange"],
  ["Sunrise Deep", "--gf-orange-deep"],
  ["Go green", "--gf-green"],
  ["Alert red", "--gf-red"],
] as const

// The prototype's Illustrations card (v38): style C, with what each picture is for.
const ILLUSTRATIONS: { name: IllustrationName; kind: "Empty" | "Loading" | "Working" | "Error"; title: string; caption: string }[] = [
  { name: "search", kind: "Empty", title: "Nothing found", caption: "No applicant matches. Clear the filter to see everyone." },
  { name: "done", kind: "Empty", title: "All caught up", caption: "Nothing is due today. New work shows up here." },
  { name: "inbox", kind: "Empty", title: "No requests", caption: "Discount and reopening requests will be listed here." },
  { name: "finding", kind: "Loading", title: "Finding the family", caption: "Loading: the lens sweeps the list until the record opens." },
  { name: "sending", kind: "Working", title: "Sending invites", caption: "Working: the plane bobs and its trail runs until the batch is done." },
  { name: "oops", kind: "Error", title: "Something went wrong", caption: "Shown with Try again. Your answers are kept." },
]
const KIND_TONE = { Empty: "line", Loading: "wait", Working: "wait", Error: "bad" } as const

// Kit quiet text on each tint a screen may draw a box in (#380): the box sets --kit-quiet (kit-page.css).
const TINTS = [
  ["whisper", "Lavender Whisper"],
  ["chrome", "Lavender Chrome"],
  ["mist", "Lavender Mist"],
] as const

const PROGRESS_STEPS = [3, 3, 2]
const PROGRESS_LABELS = ["Students", "Custodians", "Finish"]

const noSubscribe = () => () => {}

/** Tanzania's date once the page is live in the browser; "" while it is being drawn on the server. */
function useToday() {
  return useSyncExternalStore(noSubscribe, () => tanzaniaToday(), () => "")
}

/** A colour swatch labelled with its token's value, read from app/tokens.css as the browser sees it. */
function Swatch({ name, token }: { name: string; token: string }) {
  const value = useSyncExternalStore(
    noSubscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    () => "",
  )
  return (
    <div>
      <i style={{ background: `var(${token})` }} />
      <b>{name}</b>
      {value}
    </div>
  )
}

// ---------- Foundations ----------

function ColourCard() {
  return (
    <Card id="colour" title="Colour">
      <div className="kp-sw">
        {SWATCHES.map(([name, token]) => (
          <Swatch key={token} name={name} token={token} />
        ))}
      </div>
      <p className="kp-spec">
        Page background: the lavender wash, <code>135deg</code> from a fainter Whisper through a third of Mist to white.
      </p>
    </Card>
  )
}

function TypeCard() {
  return (
    <Card id="type" title="Type">
      <div className="kp-question">Mwanafunzi anaitwa nani?</div>
      <p className="kp-spec">
        Headings and questions: <code>Exo 800 italic</code>. Buttons and the current tab: <code>Exo 600–700 italic</code>. Exo is never upright.
      </p>
      <p className="kp-reading">Reading text, tables and what people type are Geist, upright, so long names stay easy to read.</p>
    </Card>
  )
}

function IconsCard() {
  return (
    <Card id="icons" title="Icons: indigo at rest, the detail orange in use" data-bento="full">
      <p className="kp-spec">
        Set 1 · Two lines: the main shape and its detail. Indigo at rest, never grey; hovered, current or pressed, the detail turns orange. 24px grid, 2px round
        stroke. Hover them.
      </p>
      <div className="kp-icg" data-icons="hover">
        {ICON_NAMES.map((name) => (
          <span key={name} title={name} data-icon-host="">
            <Icon name={name} />
            <small>{name}</small>
          </span>
        ))}
      </div>
      <div className="kp-rowx kp-icsz" data-icons="featured">
        {([16, 20, 24] as const).map((size) => (
          <span key={size}>
            <Icon name="applicants" size={size} featured />
            <small>{size}px</small>
          </span>
        ))}
        <span className="kp-on-indigo" data-icon-host="indigo">
          <Icon name="applicants" size={24} />
          <small>On indigo</small>
        </span>
        <span className="kp-on-indigo" data-icon-host="indigo">
          <Icon name="applicants" size={24} featured />
          <small>In use</small>
        </span>
      </div>
      <p className="kp-spec">16 in small buttons and rows, 20 in buttons and fields, 24 on their own. On indigo, white with a light orange detail in use.</p>
    </Card>
  )
}

function IllustrationsCard() {
  return (
    <Card id="illustrations" title="Illustrations" data-bento="full">
      <p className="kp-spec">
        C · Soft circle, for empty lists, loading and longer work: each picture sits on a lavender circle with white fills and one peach highlight. Line drawings in
        our colours, never isometric. The loading and working pictures move until the wait is over.
      </p>
      <div className="kp-ilg">
        {ILLUSTRATIONS.map(({ name, kind, title, caption }) => (
          <figure key={name} className="kp-ilt">
            <Illustration name={name} size={132} />
            <figcaption>
              <Tag tone={KIND_TONE[kind]}>{kind}</Tag>
              <b>{title}</b>
              <small>{caption}</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </Card>
  )
}

// ---------- Actions ----------

function ButtonsCard() {
  return (
    <Card id="buttons" title="Buttons">
      <Button size="wide" chevron>
        Continue
      </Button>
      <Button variant="ghost" size="wide" icon="plus">
        Yes, add a student
      </Button>
      <div className="kp-rowx">
        <Button size="small">Find</Button>
        <Button variant="ghost" size="small">
          Review
        </Button>
        <RoundButton icon="back" label="Back" />
        <RoundButton icon="reset" label="Start over" />
        <RoundButton icon="menu" label="Menu" />
      </div>
      <Button variant="bad" size="wide">
        Yes, clear the form
      </Button>
      <div className="kp-rowx">
        <Button variant="bad" size="small">
          Decline application
        </Button>
        <Button variant="warn" size="small">
          Withdraw request
        </Button>
      </div>
      <p className="kp-spec">
        One orange button per screen: the next step. Everything else is outlined; only the orange action is ever filled. A red outline closes or removes; a dark
        orange outline is a step back that can be undone.
      </p>
    </Card>
  )
}

function ButtonStatesCard() {
  const page = useDesignHref("")
  const [finding, setFinding] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <Card id="button-states" title="Button states">
      <div className="kp-rowx">
        <Button
          pending={finding}
          chevron
          onClick={() => {
            setFinding(true)
            timer.current = window.setTimeout(() => setFinding(false), 1500)
          }}
        >
          {finding ? "Finding the family…" : "Find the family"}
        </Button>
        <ButtonLink href={page} size="small" chevron>
          Open Applicants
        </ButtonLink>
        <Button disabled chevron>
          Continue
        </Button>
      </div>
      <div className="kp-rowx">
        <RoundButton icon="bell" label="New requests" size={40} />
        <RoundButton icon="x" label="Close" size={36} />
        <TextLink>Edit</TextLink>
        <TextLink>Add</TextLink>
        <TextLink>Clear</TextLink>
      </div>
    </Card>
  )
}

function ChipButtonsCard() {
  const [payment, setPayment] = useState<string | null>(null)
  return (
    <Card id="chip-buttons" title="Chip buttons">
      <ChipButtons label="What kind of payment is it?" options={PAYMENT_KINDS.map((k) => ({ value: k, label: k }))} value={payment} onChange={setPayment} />
    </Card>
  )
}

// ---------- Inputs ----------

function FieldsCard() {
  return (
    <Card id="fields" title="Fields">
      <Field placeholder="Student’s full name" aria-label="Example field" />
      <Field icon="phone" placeholder="0712 345 678" aria-label="Example phone field" />
      <Field defaultValue="Not a name" invalid aria-label="Example field with an error" aria-describedby="kp-field-error" />
      <FieldError id="kp-field-error" alignStart message="Type the full name, at least two names." />
      <NamedField id="kp-named-empty" name="Label" icon="tag" placeholder="C" />
      <NamedField id="kp-named-filled" name="Seats" icon="seats" inputMode="numeric" defaultValue="40" />
      <p className="kp-spec">The named field keeps its name inside the box when it holds a value, for Change sheets whose boxes start filled.</p>
    </Card>
  )
}

function CompactFieldsCard() {
  return (
    <Card id="compact-fields" title="Compact and search fields">
      <Field size="compact" icon="search" alignStart placeholder="Admission Number, e.g. DMSN-90005" aria-label="Admission Number" />
      <Field size="search" icon="search" placeholder="Search a name or Admission Number" aria-label="Search applicants" />
    </Card>
  )
}

function PasswordFieldCard() {
  return (
    <Card id="password-field" title="Password field">
      <PasswordField aria-label="Example password" placeholder="Password" showLabel="Show password" hideLabel="Hide password" autoComplete="off" />
      <PasswordField aria-label="Example password, filled" defaultValue="sample-password" showLabel="Show password" hideLabel="Hide password" autoComplete="off" />
      <p className="kp-spec">
        The lock at the start, and a round eye button inside the right end. Press it: the password shows and the eye is struck through. Its pupil and its slash
        turn orange on hover.
      </p>
    </Card>
  )
}

function SelectorsCard() {
  const [popPressed, setPopPressed] = useState(true)
  const [cls, setCls] = useState<string | null>("STD 6")
  const [sibling, setSibling] = useState<string | null>("sibling")
  return (
    <Card id="selectors" title="Selectors">
      <DefaultTile label="FORM 1" tagline="Most parents choose" pressed={popPressed} onClick={() => setPopPressed((p) => !p)} />
      <ChoiceTiles
        name="kp-seg"
        layout="four"
        big
        legend={<span className="sr-only">Example class</span>}
        options={["STD 5", "STD 6", "STD 7", "FORM 2"].map((c) => ({ value: c, label: c }))}
        value={cls}
        onChange={setCls}
      />
      <ChoiceTiles
        name="kp-row"
        legend={<span className="sr-only">Example sibling choice</span>}
        options={[
          { value: "sibling", label: "Sibling of Neema", description: "Father: Juma Salim Mrisho" },
          { value: "none", label: "Not a sibling", description: "A relative’s or a friend’s child" },
        ]}
        value={sibling}
        onChange={setSibling}
      />
    </Card>
  )
}

function ClassPickerCard() {
  const [sheetCls, setSheetCls] = useState<string>("STD 5")
  return (
    <Card id="class-picker" title="Class picker">
      <p className="kp-spec">
        The class sheet&rsquo;s body: the levels on the sliding track, then the level&rsquo;s classes. It opens on the level of the picked class. Picked:{" "}
        <b>{sheetCls}</b>.
      </p>
      <ClassPicker
        label="School level"
        levels={[
          { label: "Nursery", classes: ["DAY CARE", "KG 1", "KG 2"] },
          { label: "Primary", classes: ["STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7"] },
          { label: "Secondary", classes: ["FORM 1", "FORM 2", "FORM 3", "FORM 4"] },
        ]}
        picked={sheetCls}
        onPick={setSheetCls}
      />
    </Card>
  )
}

/** The form parts read the page's ?tab= and today's date in the browser, so the page stays static. */
function FormPartsLive() {
  const page = useDesignHref("")
  const tab = useSearchParams().get("tab") ?? ""
  const today = useToday()
  if (!today) return <FormPartsCard page={page} tab="" today={tanzaniaToday()} />
  return <FormPartsCard key={today} page={page} tab={tab} today={today} />
}

function FormPartsSlot() {
  const page = useDesignHref("")
  return (
    <Suspense fallback={<FormPartsCard page={page} tab="" today={tanzaniaToday()} />}>
      <FormPartsLive />
    </Suspense>
  )
}

// ---------- Forms and steps ----------

function GuidedFormCard() {
  return (
    <Card id="guided-form" title="Guided form" data-bento="full">
      <GuidedDemo />
    </Card>
  )
}

function StepperCard() {
  const [filled, setFilled] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const total = PROGRESS_STEPS.reduce((a, b) => a + b, 0)
  let left = filled
  const groups: ProgressGroup[] = PROGRESS_STEPS.map((steps, i) => {
    const done = Math.min(steps, left)
    left -= done
    return { label: PROGRESS_LABELS[i], steps, done, current: -1 }
  })
  const activeGroup = Math.max(0, groups.findIndex((g) => g.done < g.steps))

  function play() {
    timers.current.forEach((t) => window.clearTimeout(t))
    setFilled(0)
    timers.current = Array.from({ length: total }, (_, i) => window.setTimeout(() => setFilled(i + 1), 420 * (i + 1)))
  }

  return (
    <Card id="stepper" title="Stepper: chip bar">
      <ProgressBar className="kp-static" groups={groups} activeGroup={activeGroup} canBack onBack={() => {}} labels={{ back: "Back", reset: "Start over" }} status="" />
      <Button variant="ghost" size="small" onClick={play} style={{ alignSelf: "flex-start" }}>
        Play it
      </Button>
      <p className="kp-spec">
        Chips fill one by one. A finished group closes into one bar, light runs through it, the outline circle draws itself, then its tick, and the number cheers. Folds take{" "}
        <code>300ms</code> on <code>cubic-bezier(0.16, 1, 0.3, 1)</code>.
      </p>
    </Card>
  )
}

function AnswersChangeCard() {
  return (
    <Card id="answers-change" title="Answers with Change">
      <p className="kp-spec">
        A key-value list whose rows each take an action: a Mist line between rows and Change in its own column. Under <code>521px</code> the value goes under its key
        and Change stays on the right. Used on the Family page.
      </p>
      <KeyValueList
        items={[
          { key: "Full name", value: "Neema Juma Mrisho", action: <TextLink>Change</TextLink> },
          { key: "Boy or girl", value: "Girl", action: <TextLink>Change</TextLink> },
          { key: "Previous school", value: "Example Primary School · Public · Dar es Salaam", action: <TextLink>Change</TextLink> },
        ]}
      />
    </Card>
  )
}

function SummaryRowsCard() {
  return (
    <Card id="summary-rows" title="Summary rows">
      <p className="kp-spec">
        <code>SummaryRow stacked</code> with <code>ChangeLink small</code>: the question small and grey on top, light Change on its right, and the bold answer full width
        underneath.
      </p>
      <ol className="gf-stack">
        <GuidedHead
          aside={
            <ChangeLink small>
              <GuidedIcon name="plus" small />
              Add Student
            </ChangeLink>
          }
        >
          Students
        </GuidedHead>
        <li className="gf-item">
          <SummaryRow stacked label="Full name" value="AMINA JUMA SALIM" sub="Father: JUMA SALIM MRISHO" action={<ChangeLink small>Change</ChangeLink>} />
        </li>
        <li className="gf-item">
          <SummaryRow
            stacked
            icon={<GuidedIcon name="user" className="size-[15px]" />}
            label="STD 3 · 2027 · Boarding"
            value="HASSAN JUMA SALIM"
            action={<ChangeLink small>Change</ChangeLink>}
          />
        </li>
        <li className="gf-item">
          <SummaryRow stacked label="Discount code" value="No code" none action={<ChangeLink small>Change</ChangeLink>} />
        </li>
        <li className="gf-item">
          <SummaryRow stacked label="Fee" value="TZS 7,500 · with code" action={<OfferPill onClick={() => {}}>TZS 2,500 off</OfferPill>} />
        </li>
        <li className="gf-item">
          <SummaryRow
            stacked
            label="Custodian of Amina and Hassan"
            value="JUMA SALIM MRISHO · Father · 0712 345 678 · WhatsApp 0754 111 222 · already on file"
            action={<ChangeLink small>Change</ChangeLink>}
          />
        </li>
        <li className="gf-item">
          <SummaryRow stacked label="Class · from the Admission form" value="STD 5 · 2027" />
        </li>
        <li className="gf-item">
          <SummaryRow stacked value="AMINA JUMA SALIM · FORM 1" sub="Without a label, the answer sits on the top line beside Change." action={<ChangeLink small>Change</ChangeLink>} />
        </li>
      </ol>
    </Card>
  )
}

// ---------- Layout and lists ----------

/** The applicant the table last opened, shown by the Sections card. */
const PickedApplicant = createContext<{ picked: string; setPicked: (number: string) => void }>({ picked: APPLICANTS[0].number, setPicked: () => {} })

function PageHeaderCard() {
  return (
    <Card id="page-header" title="Page header" data-bento="full">
      <PageHeader
        level={2}
        title="Applicants"
        subtitle="Every student, from Applied to Enrolled."
        actions={
          <Button size="small" chevron>
            Register students
          </Button>
        }
      />
    </Card>
  )
}

function FilterTableCard({ linkFilter }: { linkFilter: string }) {
  const page = useDesignHref("")
  const { setPicked } = useContext(PickedApplicant)
  const [filter, setFilter] = useState("All")
  const rows = APPLICANTS.filter((a) => filter === "All" || a.status === filter)
  const filterHref = (f: string) => (f === "All" ? page : `${page}?filter=${f}`)
  return (
    <Card id="filter-table" title="Filter pills and table" data-bento="full">
      <FilterPills label="Filter by status" options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter}>
        <Tag tone="line">Previous school not known yet</Tag>
        <TextLink onClick={() => setFilter("All")}>Clear</TextLink>
      </FilterPills>
      {rows.length > 0 ? (
        <Table
          label="Applicants"
          rows={rows}
          rowKey={(a) => a.number}
          rowLabel={(a) => a.name}
          onOpen={(a) => setPicked(a.number)}
          columns={[
            {
              header: "Student",
              cell: (a) => (
                <>
                  <b>{a.name}</b>
                  <small>{a.number}</small>
                </>
              ),
            },
            { header: "Class", cell: (a) => a.cls },
            { header: "Custodian", cell: (a) => a.custodian },
            { header: "Status", cell: (a) => <StatusChip status={a.status} /> },
            { header: "Next step", cell: (a) => a.next },
          ]}
        />
      ) : (
        <EmptyState title="No applicant matches" hint="Clear the filter to see everyone." />
      )}
      <FilterPills
        label="Filter by status, as links"
        className="kp-links"
        options={FILTERS.map((f) => ({ label: f, href: filterHref(f) }))}
        current={filterHref(FILTERS.includes(linkFilter) ? linkFilter : "All")}
        scroll={false}
      />
    </Card>
  )
}

/** The link filter pills read the page's ?filter= in the browser, so the page stays static. */
function FilterTableLive() {
  return <FilterTableCard linkFilter={useSearchParams().get("filter") ?? ""} />
}

function FilterTableSlot() {
  return (
    <Suspense fallback={<FilterTableCard linkFilter="" />}>
      <FilterTableLive />
    </Suspense>
  )
}

function TableCard() {
  return (
    <Card id="table" title="Table" data-bento="full">
      <Table
        label="Fee schedule"
        rows={FEE_SCHEDULE}
        rowKey={(r) => r[0]}
        columns={[
          { header: "Class", cell: (r) => <b>{r[0]}</b> },
          { header: "Day", cell: (r) => r[1], align: "end" },
          { header: "Boarding", cell: (r) => r[2], align: "end" },
          { header: "Minimum deposit", cell: (r) => r[3], align: "end" },
        ]}
      />
    </Card>
  )
}

function ListRowCard() {
  return (
    <Card id="list-row" title="List row" data-bento="full">
      {DISCOUNT_REQUESTS.map((d) => (
        <ListRow
          key={d.name}
          icon="discounts"
          title={`${d.name} · ${d.kind}`}
          caption={`${d.why} · ${d.by}`}
          trailing={
            <>
              <Tag tone="wait">Waiting</Tag>
              <Button variant="ghost" size="small">
                Review
              </Button>
            </>
          }
        />
      ))}
      {CAMPUS.map((c) => (
        <ListRow
          key={c.name}
          leading={<Tag tone="line">{c.when}</Tag>}
          title={c.name}
          caption={c.about}
          trailing={<StatusChip status={c.status} />}
          onClick={c.checkIn ? () => {} : undefined}
        />
      ))}
    </Card>
  )
}

function StatCardCard() {
  return (
    <Card id="stat-card" title="Stat card" data-bento="full">
      <div className="kp-stats">
        <StatCard
          title="Interviews today"
          icon="interviews"
          value={14}
          trend={{ change: 3, label: "3 more than the same day last week" }}
          actions={<RoundButton icon="calendar" label="Open the calendar" size={40} />}
        />
        <StatCard
          title="Applied 9–15 Nov"
          icon="applicants"
          value={42}
          trend={{ change: 0, label: "Same as the week before" }}
          actions={<RoundButton icon="filter" label="Show another week" size={40} on />}
        />
        <StatCard
          title="Applied this week"
          icon="applicants"
          value={37}
          trend={{ change: -5, label: "5 fewer than last week" }}
          actions={<RoundButton icon="filter" label="Show another week" size={40} />}
        />
      </div>
      <p className="kp-spec">
        An 18px indigo icon before the title, nothing behind it at rest. Hover a card or tab to its button: the icon’s detail turns orange and a round Lavender Whisper
        highlight grows in (it fades in place under reduced motion). The number sits under the icon, Exo 800 italic 48.5px, with its trend (up, no change, down); Home
        puts its 7-day line at the bottom.
      </p>
    </Card>
  )
}

function CardsChipsCard() {
  return (
    <Card id="cards-chips" title="Cards and chips">
      <div className="kp-rowx">
        {(["Applied", "Visited", "Interviewed", "Enrolled", "Declined"] as LeadStatus[]).map((s) => (
          <StatusChip key={s} status={s} />
        ))}
        <Tag tone="wait">Waiting</Tag>
      </div>
      <p className="kp-spec">
        White card, <code>0.75px</code> indigo line at 22%, a soft indigo shadow. Only the card that holds the task is lifted.
      </p>
      <Note tone="good">Fathers’ names match. The 10% sibling discount applies by itself.</Note>
      <Note tone="wait">Fathers’ names don’t match. Ask for proof.</Note>
    </Card>
  )
}

function ApplicantDetail({ a }: { a: Applicant }) {
  return (
    <div className="kp-detail">
      <Section title="Student">
        <KeyValueList
          items={[
            { key: "Admission Number", value: a.number, numeric: true },
            { key: "Class", value: a.cls },
            {
              key: "Father’s full name",
              value: (
                <>
                  {a.father} <TextLink>Edit</TextLink>
                </>
              ),
            },
            { key: "Previous school", value: a.school },
          ]}
        />
      </Section>
      <Section title="Custodian">
        <KeyValueList
          items={[
            { key: "Name", value: a.custodian },
            { key: "Relationship", value: a.relationship },
            { key: "Brought by", value: a.broughtBy },
          ]}
        />
      </Section>
      {a.fee && (
        <Section title="School fee">
          <KeyValueList
            items={[
              { key: "Fee this year", value: a.fee, reason: "Full fee", numeric: true },
              { key: "Paid so far", value: a.paid, numeric: true },
            ]}
          />
          <div className="kp-rowx" style={{ marginTop: 12 }}>
            <Button variant="ghost" size="small">
              Record payment
            </Button>
            <TextLink>Edit fee</TextLink>
          </div>
        </Section>
      )}
      <Note>Next step: {a.next}.</Note>
    </div>
  )
}

function SectionsCard() {
  const { picked } = useContext(PickedApplicant)
  const current = APPLICANTS.find((a) => a.number === picked) ?? APPLICANTS[0]
  return (
    <Card id="sections-kv" title="Sections and key-value list">
      <ApplicantDetail a={current} />
      <div className="kp-tints">
        {TINTS.map(([surface, name]) => (
          <div key={surface} data-surface={surface}>
            <KeyValueList items={[{ key: name, value: FEE_SCHEDULE[0][1], reason: "Full fee", numeric: true }]} />
          </div>
        ))}
      </div>
    </Card>
  )
}

function CodeBlockCard() {
  return (
    <Card id="code-block" title="Code block">
      <CodeBlock copyValue="claude mcp add --transport http alrahmah-design https://design.alrahmahcomplex.or.tz/mcp" copyLabel="Copy command" copiedMessage="Copied" copyFailedMessage="Couldn’t copy. The text is selected: press Ctrl+C.">
        {"claude mcp add --transport http alrahmah-design \\\n  https://design.alrahmahcomplex.or.tz/mcp"}
      </CodeBlock>
      <CodeBlock
        label="~/.codex/config.toml"
        copyValue={'[mcp_servers.alrahmah-design]\nurl = "https://design.alrahmahcomplex.or.tz/mcp"'}
        copyLabel="Copy settings"
        copiedMessage="Copied"
        copyFailedMessage="Couldn’t copy. The text is selected: press Ctrl+C."
      >
        {'[mcp_servers.alrahmah-design]\nurl = "https://design.alrahmahcomplex.or.tz/mcp"'}
      </CodeBlock>
      <p className="kp-spec">
        A command or a few lines of settings on Lavender Chrome, with the code chip’s copy button. Long lines scroll sideways inside the block. When the browser refuses
        the clipboard, the text is selected so it can be copied by hand.
      </p>
    </Card>
  )
}

// ---------- Feedback ----------

function ChipsCard() {
  return (
    <Card id="chips" title="Chips">
      <div className="kp-rowx">
        {(["Applied", "Visited", "Interviewed", "Enrolled", "Declined", "Inactive", "Archived"] as const).map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </div>
      <div className="kp-rowx">
        <Tag tone="wait">Waiting</Tag>
        <Tag tone="ok">Paid</Tag>
        <Tag tone="bad">Overdue</Tag>
        <Tag tone="line">Tomorrow</Tag>
        <Tag tone="wait">Not known yet</Tag>
      </div>
    </Card>
  )
}

function NoteCard() {
  return (
    <Card id="note" title="Note">
      <Note>Next step: Release the result.</Note>
      <Note tone="good">The 10% sibling discount is on 2 students.</Note>
      <Note tone="wait" icon="info">
        Sent from the Admission form. Check-in fills in the missing answers.
      </Note>
      <Note tone="bad">The payment form could not open. Check your connection and try again.</Note>
    </Card>
  )
}

function EmptyStateCard() {
  return (
    <Card id="empty-state" title="Empty state">
      <EmptyState
        title="No applicant matches"
        hint="Clear the filter to see everyone."
        action={
          <Button variant="ghost" size="small">
            Clear the filter
          </Button>
        }
      />
      <EmptyState illustration="done" title="All caught up" hint="New work shows up here." />
      <EmptyState illustration="oops" title="Something went wrong" hint="Your answers are kept." action={<Button size="small">Try again</Button>} />
    </Card>
  )
}

function LoadingStateCard() {
  return (
    <Card id="loading-state" title="Loading state">
      <LoadingState label="Finding the family…" />
      <LoadingState illustration="sending" label="Sending invites…" />
    </Card>
  )
}

function SkeletonCard() {
  return (
    <Card id="skeleton" title="Skeleton">
      <div className="kp-skel">
        <SkeletonBlock width="60%" height={28} />
        <SkeletonBlock width="85%" height={14} />
        <SkeletonBlock width={140} height={36} shape="pill" />
        <SkeletonBlock height={120} shape="card" />
      </div>
    </Card>
  )
}

function TaskFinishedCard() {
  return (
    <Card id="task-finished" title="Task card and finished state" data-bento="full">
      <TaskCard className="kp-task">
        <FinishedState
          title="2 students registered"
          hint="Give the family these Admission Numbers."
          results={[
            { label: "Bakari Rashidi Kombo Said", value: "DMSN-90013" },
            { label: "Latifa Omari Juma Hassan", value: "DMSN-90014" },
          ]}
        >
          <Note tone="wait">1 discount request waits for the Admissions Manager. Remind the family to bring proof.</Note>
          <Button size="wide" chevron>
            Open Applicants
          </Button>
          <Button variant="ghost" size="wide">
            Register another family
          </Button>
        </FinishedState>
      </TaskCard>
    </Card>
  )
}

// ---------- App parts ----------

function ShellCard() {
  return (
    <Card id="shell" title="Shell: frame, top bar and sidebar" data-bento="full">
      <p className="kp-spec">
        Every site’s frame, the one this page sits in. A white frame holds the top bar and one rounded stage with a thin outline; every page sits inside the stage. The
        sidebar opens with its pages in 38px rows, 4px apart, and folds to a 60px rail of icons in 38px circles; on a phone it is a drawer. A page with sections lists
        them under its row, in groups that open one at a time, and the section on screen is marked as the page scrolls.
      </p>
    </Card>
  )
}

// ---------- the page ----------

const CARDS: Record<string, () => ReactNode> = {
  colour: ColourCard,
  type: TypeCard,
  icons: IconsCard,
  illustrations: IllustrationsCard,
  buttons: ButtonsCard,
  "button-states": ButtonStatesCard,
  "chip-buttons": ChipButtonsCard,
  fields: FieldsCard,
  "compact-fields": CompactFieldsCard,
  "password-field": PasswordFieldCard,
  selectors: SelectorsCard,
  "class-picker": ClassPickerCard,
  "confirmation-number": ConfirmationNumberCard,
  "last-name": LastNameCard,
  "type-ahead": PlaceListsCard,
  "two-choices": TwoChoicesCard,
  "popover-list": ListInPopoverCard,
  "names-codes": NamesCard,
  "form-parts": FormPartsSlot,
  "guided-form": GuidedFormCard,
  stepper: StepperCard,
  "stepper-reset": ChipUpBarCard,
  "answers-change": AnswersChangeCard,
  "summary-rows": SummaryRowsCard,
  "step-track": StepTrackCard,
  slider: SliderCard,
  "sign-up-steps": SignUpPartsCard,
  "page-header": PageHeaderCard,
  "filter-table": FilterTableSlot,
  table: TableCard,
  "list-row": ListRowCard,
  "stat-card": StatCardCard,
  tabs: TabsCard,
  pagination: PaginationCard,
  "cards-chips": CardsChipsCard,
  "filter-menu": FilterMenuCard,
  "link-rows": LinkRowsCard,
  "sections-kv": SectionsCard,
  accordion: AccordionCard,
  timeline: TimelineCard,
  "code-block": CodeBlockCard,
  chips: ChipsCard,
  note: NoteCard,
  toast: ToastCard,
  tooltips: TooltipsCard,
  "empty-state": EmptyStateCard,
  "loading-state": LoadingStateCard,
  skeleton: SkeletonCard,
  finish: FinishCard,
  "task-finished": TaskFinishedCard,
  sheet: SheetCard,
  "side-sheet": SideSheetCard,
  popover: PopoverCard,
  "profile-row": ProfileRowCard,
  shell: ShellCard,
  avatars: AvatarsCard,
  "code-chip": CodeChipCard,
  "top-bar-swap": TopBarSwapCard,
}

/** A group's anchor: "Forms and steps" is #group-forms-and-steps. */
export const groupId = (group: PartGroup) => `group-${group.toLowerCase().replaceAll(" ", "-")}`

function Group({ group, parts }: { group: PartGroup; parts: Part[] }) {
  return (
    <section className="kp-group" id={groupId(group)} aria-labelledby={`${groupId(group)}-h`}>
      <h2 className="kp-group-title" id={`${groupId(group)}-h`}>
        {group}
      </h2>
      <Bento className="kp-ds" data-rise="group">
        {parts.map((part) => {
          const Draw = CARDS[part.id]
          return <Draw key={part.id} />
        })}
      </Bento>
    </section>
  )
}

/** Every card exists for every part of the catalogue (tests/unit/design-site-catalog.test.ts). */
export const KIT_CARD_IDS = Object.keys(CARDS)

/** Whether a part matches the top bar's search: its name, group, what it is for, or the files it lives in. */
export function partMatches(part: Part, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const text = [part.id, part.title, part.group, part.summary, ...part.files].join(" ").toLowerCase()
  return words.every((word) => text.includes(word))
}

// Drawn in the shell, which holds the stage, the page column and the kit Toaster.
export function KitPage() {
  const [picked, setPicked] = useState(APPLICANTS[0].number)
  const query = usePartSearch()
  const groups = PART_GROUPS.map((group) => ({ group, parts: partsIn(group).filter((part) => partMatches(part, query)) })).filter((g) => g.parts.length > 0)
  return (
    <PickedApplicant.Provider value={{ picked, setPicked }}>
      <PageHeader title="Design system" subtitle="Every piece below is copied from the Admission form’s code, so the staff side and the parent side stay one family." />
      {groups.map(({ group, parts }) => (
        <Group key={group} group={group} parts={parts} />
      ))}
      {groups.length === 0 && (
        <Card className="kp-group">
          <EmptyState illustration="search" title="No part matches" hint="Clear the search to see every part." />
        </Card>
      )}
    </PickedApplicant.Provider>
  )
}
