"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { ProgressBar, type ProgressGroup } from "@/components/guided-form/progress-bar"
import { Icon, ICONS, type IconName } from "@/components/icons"
import { Illustration, type IllustrationName } from "@/components/illustrations"
import {
  Button,
  ButtonLink,
  Card,
  ChipButtons,
  ChoiceTiles,
  DefaultTile,
  EmptyState,
  Field,
  FieldError,
  FilterPills,
  FinishedState,
  KeyValueList,
  ListRow,
  LoadingState,
  Note,
  PageHeader,
  RoundButton,
  Section,
  SkeletonBlock,
  StatusChip,
  Table,
  Tag,
  TaskCard,
  TextLink,
} from "@/components/kit"
import type { LeadStatus } from "@/lib/services/leads"

import { APPLICANTS, CAMPUS, DISCOUNT_REQUESTS, FEE_SCHEDULE, FILTERS, PAYMENT_KINDS, type Applicant } from "./fixtures"
import { FormPartsCard, ListInPopoverCard } from "./form-parts"
import { GuidedDemo } from "./guided-demo"
import "./kit-page.css"
import { OverlayCards } from "./overlays"

// The approved prototype's "Design system" page (version 13), rebuilt with
// the kit, card for card; then the kit's other pieces, filled with the
// prototype's own example data. Fixture text only.

const ICON_NAMES = (Object.keys(ICONS) as IconName[]).filter((name) => ICONS[name].detail && ICONS[name].circle)

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

const ILLUSTRATIONS: [IllustrationName, string][] = [
  ["empty", "Nothing to show"],
  ["loading", "Loading"],
  ["finished", "Finished"],
  ["front-desk", "Front desk"],
]

const PROGRESS_STEPS = [3, 3, 2]
const PROGRESS_LABELS = ["Students", "Custodians", "Finish"]

const noSubscribe = () => () => {}

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

function DesignSystem({ tab }: { tab: string }) {
  const [popPressed, setPopPressed] = useState(true)
  const [cls, setCls] = useState<string | null>("STD 6")
  const [sibling, setSibling] = useState<string | null>("sibling")
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
    <div className="kp-ds" data-part="design-system" data-rise="group">
      <Card title="Icons: one colour at rest, two in use" className="kp-full">
        <p className="kp-spec">One colour at rest. Two colours when hovered, current, or shown large. Hover the icons to see it.</p>
        <div className="kp-ds" data-rise="group">
          <Card title="Set 2 · Soft highlight">
            <p className="kp-spec">From your second picture: an indigo outline over a faint light-orange shape that grows in.</p>
            <div className="kp-icg" data-icons="hover">
              {ICON_NAMES.map((name) => (
                <span key={name} title={name} data-icon-host="">
                  <Icon name={name} />
                </span>
              ))}
            </div>
            <div className="kp-icg" data-icons="featured">
              {ICON_NAMES.slice(0, 9).map((name) => (
                <span key={name}>
                  <Icon name={name} featured />
                </span>
              ))}
            </div>
          </Card>
        </div>
      </Card>

      <Card title="Illustrations" className="kp-full">
        <p className="kp-spec">Isometric, in our colours, for the moments between work: nothing to show, waiting, and finished. Working screens keep the line icons.</p>
        <div className="kp-rowx" style={{ justifyContent: "space-around" }}>
          {ILLUSTRATIONS.map(([name, caption]) => (
            <figure key={name} className="kp-fig">
              <Illustration name={name} size={150} />
              <figcaption className="kp-spec">{caption}</figcaption>
            </figure>
          ))}
        </div>
      </Card>

      <Card title="Colour">
        <div className="kp-sw">
          {SWATCHES.map(([name, token]) => (
            <Swatch key={token} name={name} token={token} />
          ))}
        </div>
        <p className="kp-spec">
          Page background: the lavender wash, <code>135deg</code> from Whisper through half Mist to white.
        </p>
      </Card>

      <Card title="Type">
        <div className="kp-question">Mwanafunzi anaitwa nani?</div>
        <p className="kp-spec">
          Headings and questions: <code>Exo 800 italic</code>. Buttons and the current tab: <code>Exo 600–700 italic</code>. Exo is never upright.
        </p>
        <p className="kp-reading">Reading text, tables and what people type are Geist, upright, so long names stay easy to read.</p>
      </Card>

      <Card title="Buttons">
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
        <p className="kp-spec">One orange button per screen: the next step. Pills everywhere a person presses.</p>
      </Card>

      <Card title="Fields">
        <Field placeholder="Student’s full name" aria-label="Example field" />
        <Field icon="phone" placeholder="0712 345 678" aria-label="Example phone field" />
        <Field defaultValue="Not a name" invalid aria-label="Example field with an error" aria-describedby="kp-field-error" />
        <FieldError id="kp-field-error" alignStart message="Type the full name, at least two names." />
      </Card>

      <Card title="Selectors">
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

      <FormPartsCard tab={tab} />

      <Card title="Progress bar">
        <ProgressBar
          className="kp-static"
          groups={groups}
          activeGroup={activeGroup}
          canBack
          onBack={() => {}}
          labels={{ back: "Back", reset: "Start over" }}
          status=""
        />
        <Button variant="ghost" size="small" onClick={play} style={{ alignSelf: "flex-start" }}>
          Play it
        </Button>
        <p className="kp-spec">
          Chips fill one by one. A finished group closes into one bar, light runs through it, a green tick lands and the number cheers. Folds take{" "}
          <code>300ms</code> on <code>cubic-bezier(0.16, 1, 0.3, 1)</code>.
        </p>
      </Card>

      <Card title="Cards and chips">
        <div className="kp-rowx">
          {(["Applied", "Visited", "Interviewed", "Enrolled", "Declined"] as LeadStatus[]).map((s) => (
            <StatusChip key={s} status={s} />
          ))}
          <Tag tone="wait">Waiting</Tag>
        </div>
        <p className="kp-spec">
          White card, <code>1.5px</code> indigo line at 22%, a soft indigo shadow. Only the card that holds the task is lifted.
        </p>
        <Note tone="good">Fathers’ names match. The 10% sibling discount applies by itself.</Note>
        <Note tone="wait">Fathers’ names don’t match. Ask for proof.</Note>
      </Card>
    </div>
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

function MorePieces() {
  const [filter, setFilter] = useState("All")
  const [picked, setPicked] = useState(APPLICANTS[0].number)
  const [payment, setPayment] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const rows = APPLICANTS.filter((a) => filter === "All" || a.status === filter)
  const current = APPLICANTS.find((a) => a.number === picked) ?? APPLICANTS[0]

  return (
    <div className="kp-ds" data-part="more" data-rise="group">
      <Card title="Page header" className="kp-full">
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

      <Card title="Filter pills and table" className="kp-full">
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
      </Card>

      <Card title="Table" className="kp-full">
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

      <Card title="List row" className="kp-full">
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

      <Card title="Sections and key-value list">
        <ApplicantDetail a={current} />
      </Card>

      <Card title="Chips">
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

      <Card title="Button states">
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
          <ButtonLink href="/staff/applicants" size="small" chevron>
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

      <Card title="Compact and search fields">
        <Field size="compact" icon="search" alignStart placeholder="Admission Number, e.g. DMSN-90005" aria-label="Admission Number" />
        <Field size="search" icon="search" placeholder="Search a name or Admission Number" aria-label="Search applicants" />
      </Card>

      <Card title="Chip buttons">
        <ChipButtons label="What kind of payment is it?" options={PAYMENT_KINDS.map((k) => ({ value: k, label: k }))} value={payment} onChange={setPayment} />
      </Card>

      <Card title="Note">
        <Note>Next step: Release the result.</Note>
        <Note tone="good">The 10% sibling discount is on 2 students.</Note>
        <Note tone="wait" icon="info">
          Sent from the Admission form. Check-in fills in the missing answers.
        </Note>
        <Note tone="bad">The payment form could not open. Check your connection and try again.</Note>
      </Card>

      <Card title="Empty state">
        <EmptyState title="No applicant matches" hint="Clear the filter to see everyone." />
      </Card>

      <Card title="Loading state">
        <LoadingState label="Finding the family…" />
      </Card>

      <Card title="Skeleton">
        <div className="kp-skel">
          <SkeletonBlock width="60%" height={28} />
          <SkeletonBlock width="85%" height={14} />
          <SkeletonBlock width={140} height={36} shape="pill" />
          <SkeletonBlock height={120} shape="card" />
        </div>
      </Card>

      <Card title="Task card and finished state" className="kp-full">
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

      <Card title="Guided form" className="kp-full">
        <GuidedDemo />
      </Card>

      <OverlayCards />
      <ListInPopoverCard />
    </div>
  )
}

// Drawn in the new shell (#322), which holds the stage, the page column and the kit Toaster.
export function KitPage({ tab = "" }: { tab?: string }) {
  return (
    <>
      <PageHeader title="Design system" subtitle="Every piece below is copied from the Admission form’s code, so the staff side and the parent side stay one family." />
      <DesignSystem tab={tab} />
      <MorePieces />
    </>
  )
}
