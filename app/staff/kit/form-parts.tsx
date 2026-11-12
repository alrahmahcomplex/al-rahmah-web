"use client"

import { useId, useRef, useState } from "react"

import {
  Button,
  Calendar,
  Card,
  Checkbox,
  DateField,
  DateTimeField,
  Disclosure,
  FieldError,
  FilePicker,
  Popover,
  RoundButton,
  Select,
  Sheet,
  Switch,
  Tabs,
  TextArea,
  toast,
} from "@/components/kit"
import { addDays, mondayOf, todayIso } from "@/components/kit/dates"

// The prototype's Design system card "Form parts on the student's record"
// and its "See them in a sheet" button (version 18, #358), with its words and
// example data. The card is one plain form: every part in it is uncontrolled,
// so the browser tests can read what it would post. Nothing is saved.

const TABS = [
  ["Overview", ""],
  ["Interview", "interview"],
  ["School fee", "school-fee"],
  ["Follow-ups", "follow-ups"],
  ["Discounts", "discounts"],
] as const

const PAYMENT_TYPES = ["Full payment", "Initial deposit", "First instalment", "Second instalment", "Third instalment"].map((t) => ({ value: t, label: t }))
const WHY_NOT = [
  "Enrolled elsewhere",
  "Family changed plans",
  "Fees or cost",
  "Fee payment not completed",
  "No seat available",
  "Did not pass interview",
  "Unreachable after follow-up",
  "School decision",
  "Other",
].map((t) => ({ value: t, label: t }))
// The Reports panel filter's own words and choices (app/staff/reports/_dashboard/panel-filter.tsx).
const PERIODS = [
  { value: "all", label: "All time" },
  { value: "date", label: "Date" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]

// The Audit filter's "Who" (app/staff/audit/page.tsx): "" is a real choice, "Anyone".
const WHO = [
  { value: "", label: "Anyone" },
  { value: "system", label: "System" },
  { value: "public_form", label: "Admission form" },
  { value: "workbook_import", label: "Workbook import" },
]

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const short = (day: string) => `${+day.slice(8)} ${MONTHS[+day.slice(5, 7) - 1]}`
const WHY_HINT = "Optional. Anything the reason alone doesn’t say."

const tabHref = (key: string) => (key ? `/staff/kit?tab=${key}` : "/staff/kit")

function Labelled({ id, label, hint, hintId, children }: { id?: string; label: string; hint?: string; hintId?: string; children: React.ReactNode }) {
  return (
    <div className="kp-fld">
      {id ? (
        <label className="kp-fl" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="kp-fl">{label}</span>
      )}
      {children}
      {hint && (
        <p className="kp-spec" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** The prototype's "See them in a sheet": the Decline sheet with a choice list and long text. */
function DeclineSheet() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [missing, setMissing] = useState(false)
  const reasonRef = useRef<HTMLButtonElement>(null)
  const ids = { reason: useId(), note: useId(), hint: useId(), error: useId() }

  const go = () => {
    if (!reason) {
      setMissing(true)
      reasonRef.current?.focus()
      return
    }
    setOpen(false)
    toast("Prototype: the next step asks you to confirm, as it does today.")
  }

  return (
    <>
      <Button
        variant="ghost"
        size="small"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          setReason("")
          setNote("")
          setMissing(false)
          setOpen(true)
        }}
      >
        See them in a sheet
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Decline Yusuf Ali Hassan"
        hint="DMSN-90005 · Applied. Say why the family or the school won’t go ahead."
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" onClick={go}>
              Continue
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <Labelled id={ids.reason} label="Reason">
          <Select
            ref={reasonRef}
            id={ids.reason}
            placeholder="Choose a reason"
            options={WHY_NOT}
            value={reason}
            onValueChange={(next) => {
              setReason(next)
              setMissing(false)
            }}
            invalid={missing}
            aria-describedby={missing ? ids.error : undefined}
          />
        </Labelled>
        <Labelled id={ids.note} label="Explanation" hint={reason === "Other" ? "Required for Other." : WHY_HINT} hintId={ids.hint}>
          <TextArea id={ids.note} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby={ids.hint} />
        </Labelled>
        <FieldError id={ids.error} message={missing ? "Choose a reason." : undefined} alignStart />
      </Sheet>
    </>
  )
}

/** The calendar sitting open with a week chosen, and the sentence under it. */
function WeekPart() {
  const [day, setDay] = useState(() => todayIso())
  const monday = mondayOf(day)
  const sunday = addDays(monday, 6)
  return (
    <div className="kp-fld">
      <span className="kp-fl" id="kp-week-l">
        Week
      </span>
      <Calendar mode="week" label="Week" value={day} onPick={setDay} />
      <p className="kp-spec" aria-live="polite" data-week={monday}>
        {`Chosen: ${short(monday)} to ${short(sunday)} ${sunday.slice(0, 4)}`}
      </p>
    </div>
  )
}

export function FormPartsCard({ tab }: { tab: string }) {
  const [filters, setFilters] = useState([false, true])
  const today = todayIso()
  const current = TABS.find(([, key]) => key === tab) ?? TABS[0]
  const ids = { pay: useId(), paid: useId(), paidHint: useId(), at: useId(), atLabel: useId(), why: useId(), whyHint: useId(), ends: useId() }

  return (
    <Card title="Form parts on the student’s record" className="kp-full">
      <p className="kp-spec">
        Ten parts the student’s record and the other screens need. Each one borrows a look already on this page. Lists and the calendar open in our own popups,
        never the browser’s grey ones.
      </p>
      <form className="kp-fpg" data-kit-form="form-parts" onSubmit={(event) => event.preventDefault()}>
        <div className="kp-fpc">
          <h3>Tabs</h3>
          <Tabs label="Student record sections" scroll={false} tabs={TABS.map(([label, key]) => ({ label, href: tabHref(key) }))} current={tabHref(current[1])} />
          <p className="kp-spec">Showing: {current[0]}</p>
        </div>
        <div className="kp-fpc">
          <h3>Choice list</h3>
          <Labelled id={ids.pay} label="Payment type">
            <Select id={ids.pay} name="payment_type" required placeholder="Choose a type" options={PAYMENT_TYPES} />
          </Labelled>
          <p className="kp-spec">Hover is lavender. The chosen item is indigo with a tick.</p>
        </div>
        <div className="kp-fpc">
          <h3>Date</h3>
          <Labelled id={ids.paid} label="Payment date" hint="The day the family paid: today or earlier." hintId={ids.paidHint}>
            <DateField id={ids.paid} name="paid_on" required max={today} aria-describedby={ids.paidHint} />
          </Labelled>
          <div className="kp-fld">
            <span className="kp-fl" id={ids.atLabel}>
              Contacted at
            </span>
            <DateTimeField id={ids.at} name="contacted_at" defaultValue={`${today}T14:30`} max={`${today}T23:59`} aria-labelledby={ids.atLabel} />
          </div>
          <p className="kp-spec">Type the date, or pick it from the calendar. Days that are not allowed are greyed out. A time is typed on the 24-hour clock.</p>
        </div>
        <div className="kp-fpc">
          <h3>Long text</h3>
          <Labelled id={ids.why} label="Explanation" hint={WHY_HINT} hintId={ids.whyHint}>
            <TextArea id={ids.why} name="explanation" aria-describedby={ids.whyHint} />
          </Labelled>
        </div>
        <div className="kp-fpc">
          <h3>Tick box</h3>
          <div>
            <Checkbox
              name="pre_form_one"
              label="Pre-Form One programme"
              hint="Tick when the family takes up the programme before Form 1. Its fee is charged on its own."
            />
            <Checkbox name="has_sibling" label="Has a sibling already at Al-Rahmah" defaultChecked />
          </div>
          <p className="kp-spec">A tick box is saved with its form.</p>
        </div>
        <div className="kp-fpc">
          <h3>Switch</h3>
          <div>
            <Switch label="Example switch, off" />
            <Switch label="Example switch, on" defaultChecked />
          </div>
          <p className="kp-spec">A switch takes effect at once, with no Save button. No screen uses one yet.</p>
        </div>
        <div className="kp-fpc">
          <h3>Week</h3>
          <WeekPart />
          <p className="kp-spec">Inside a filter the calendar sits open. Any day chooses its week, Monday to Sunday.</p>
        </div>
        <div className="kp-fpc">
          <h3>Fold-open section</h3>
          <Disclosure label="History">
            <p className="kp-spec">No changes yet.</p>
          </Disclosure>
          <Disclosure variant="boxed" label="More options">
            <Labelled id={ids.ends} label="Ends on">
              <DateField id={ids.ends} name="ends_on" />
            </Labelled>
          </Disclosure>
          <p className="kp-spec">The chevron turns and the content folds open under it.</p>
        </div>
        <div className="kp-fpc">
          <h3>File</h3>
          <FilePicker
            name="file"
            accept=".csv,text/csv"
            title="Drop the CSV here or choose a file"
            hint="Up to 1,000 rows. Nothing is saved until you confirm."
            chooseLabel="Choose file"
            inputLabel="CSV file"
          />
          <p className="kp-spec">Once a file is chosen, its name shows in place of the first line.</p>
        </div>
        <div className="kp-fpc">
          <h3>Filter button</h3>
          <div className="kp-rowx">
            {filters.map((on, i) => (
              <RoundButton
                key={i}
                icon="filter"
                label="Filter Visited applicants"
                size={40}
                on={on}
                onClick={() => setFilters(filters.map((f, j) => (j === i ? !f : f)))}
              />
            ))}
          </div>
          <p className="kp-spec">One colour at rest. Two colours on a lavender circle while a filter is on.</p>
        </div>
      </form>
      <DeclineSheet />
    </Card>
  )
}

/**
 * The choice list inside a kit Popover, as the Reports panel filters hold it
 * (#331), with the Reports panel's words; then the Audit filter's "Who",
 * whose "Anyone" posts the empty string, in a plain form.
 */
export function ListInPopoverCard() {
  const [period, setPeriod] = useState("all")
  const id = useId()
  const whoId = useId()
  const fromId = useId()
  return (
    <Card title="Choice list in a popover">
      <div className="kp-rowx">
        <Popover
          trigger={<RoundButton icon="filter" label="Filter Visited applicants" size={40} on={period !== "all"} />}
          title="Visited applicants"
          closeLabel="Close"
        >
          <div className="kp-fld kp-pop-fld">
            <label className="kp-fl" htmlFor={id}>
              Period
            </label>
            <Select id={id} options={PERIODS} value={period} onValueChange={setPeriod} />
          </div>
        </Popover>
      </div>
      {/* As the Audit filter: a plain GET form, sent by the browser with no handler of ours. */}
      <form method="get" action="/staff/kit" className="kp-fpc" data-kit-form="who" aria-label="Filter the audit">
        <div className="kp-fld">
          <label className="kp-fl" htmlFor={fromId}>
            From
          </label>
          <DateField id={fromId} name="from" />
        </div>
        <div className="kp-fld">
          <label className="kp-fl" htmlFor={whoId}>
            Who
          </label>
          <Select id={whoId} name="actor" defaultValue="" options={WHO} />
        </div>
        <Button type="submit" size="small" style={{ alignSelf: "flex-start" }}>
          Apply
        </Button>
      </form>
    </Card>
  )
}
