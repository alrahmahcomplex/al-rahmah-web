"use client"

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"

import {
  CapitalsBox,
  CodePicker,
  ContinuePill,
  FullNameBox,
  Hint,
  Icon as GuidedIcon,
  LastNameChoice,
  PersonNameBoxes,
  QuestionTitle,
  StudentNameBoxes,
  TypeAheadField,
  cleanName,
  formatCode,
  hasTwoNames,
  type PersonName,
  type CodeOption,
  type StudentName,
} from "@/components/guided-form"
import {
  Button,
  ChoiceTiles,
  ClassPicker,
  DefaultTile,
  Field,
  FieldError,
  GuidedReveal,
  Note,
  Sheet,
  Table,
  Tag,
  TextLink,
} from "@/components/kit"
import { Icon } from "@/components/icons"
import type { LastNameFrom } from "@/lib/names"
import { countriesSavedFirst, countryFlag, countryNeed, OUTSIDE_TANZANIA, regionsOutsideFirst, sameSchoolName, schoolKey } from "@/lib/places"
import { STAFF_REMINDER } from "@/lib/referral-notice"
import { STUDENT_GENDERS, type DayOrBoarding, type LeadClass, type StudentGender } from "@/lib/services/leads"

import { lookUpReferralCode } from "../../applicants/[id]/referral-actions"
import { usableCode, type ReferralLookup } from "../../applicants/[id]/referral-outcome"
import { givenRelationship, personParts, type GivenContact } from "../[id]/model"
import { findCustodianFamily } from "./actions"
import {
  CLASS_LEVELS,
  FIRST_RELATIONSHIPS,
  POPULAR_CLASS,
  REGIONS,
  SAME_RELATIONSHIPS,
  digits,
  list,
  mentionsSiblings,
  phoneOk,
  studentName,
  type Answers,
  type Brought,
  type Custodian,
  type FeePreview,
  type KnownContact,
  type RelationshipChoice,
  type SchoolAnswer,
  type StudentNameAnswer,
} from "./model"
import { listCodesToPick } from "./code-actions"

// The questions of Register students (#308), each one open card of the
// guided stack. Words from prototype v38. The two sheets start afresh each
// time they open: their caller gives them a new key.

/** The prototype waits this long after a tap, so the chosen tile shows before the question folds. */
export const PICK_MS = 240

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const LAST_NAME_LABELS = { group: "Student’s last name", last: "Father’s last name", middle: "Father’s middle name" }
const EMPTY_STUDENT: StudentName = { firstName: "", fatherFirst: "", fatherMiddle: "", fatherLast: "" }
const EMPTY_PERSON: PersonName = { firstName: "", middleName: "", lastName: "" }
const STUDENT_KEYS = ["firstName", "fatherFirst", "fatherMiddle", "fatherLast"] as const

const OUTSIDE_LABEL = "Outside Tanzania (Other Country)"
const REGION_OPTIONS = regionsOutsideFirst(REGIONS).map((r) => ({ value: r, label: r === OUTSIDE_TANZANIA ? OUTSIDE_LABEL : r }))
const flag = (country: string) => <span className="gf-flag">{countryFlag(country)}</span>
const listLabels = (one: string, many: string) => ({
  field: one[0].toUpperCase() + one.slice(1),
  placeholder: `Type or choose a ${one}`,
  showAll: `Show all ${many}`,
  search: `Search ${many}`,
  list: many[0].toUpperCase() + many.slice(1),
  none: (q: string) => `No ${one} matches “${q}”.`,
})
const REGION_LABELS = listLabels("region", "regions")
const COUNTRY_LABELS = listLabels("country", "countries")

/** A radio group that answers on a pick, and when the chosen option is pressed again after Change. */
function again(saved: string | undefined, onPick: (v: string) => void) {
  return (e: MouseEvent) => {
    const input = e.target as HTMLInputElement
    if (input.type === "radio" && input.checked && input.value === saved) onPick(input.value)
  }
}

export function NameQuestion({ id, next, saved, onDone }: { id: string; next: boolean; saved?: StudentNameAnswer; onDone: (name: StudentNameAnswer) => void }) {
  const [name, setName] = useState<StudentName>(saved ?? EMPTY_STUDENT)
  // Which of the father's names ends the student's name (#511, prototype v50): his last name by default.
  const [lastNameFrom, setLastNameFrom] = useState<LastNameFrom>(saved?.lastNameFrom ?? "father_last")
  const [bad, setBad] = useState<keyof StudentName | null>(null)
  const titleId = `${id}-title`
  const errId = `${id}-error`
  const clean = (n: StudentName): StudentName => ({ firstName: cleanName(n.firstName), fatherFirst: cleanName(n.fatherFirst), fatherMiddle: cleanName(n.fatherMiddle), fatherLast: cleanName(n.fatherLast) })
  const v = clean(name)
  const full = studentName({ ...v, lastNameFrom })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const missing = STUDENT_KEYS.find((k) => !v[k])
    if (missing) {
      setBad(missing)
      e.currentTarget.querySelector<HTMLInputElement>(`[id="${id}-${missing}"]`)?.focus()
      return
    }
    onDone({ ...v, lastNameFrom })
  }

  return (
    <>
      <QuestionTitle id={titleId}>{next ? "What is the next student’s name?" : "What is the student’s name?"}</QuestionTitle>
      <Hint>As it is on the birth certificate.</Hint>
      <form noValidate onSubmit={submit} className="rs-col">
        <StudentNameBoxes
          id={id}
          aria-labelledby={titleId}
          aria-describedby={bad ? errId : undefined}
          labels={{ ...NAME_LABELS, student: "Student’s name", father: "Father’s name" }}
          value={name}
          invalid={bad ? { [bad]: true } : undefined}
          onChange={(n) => {
            setName(n)
            setBad(null)
          }}
        />
        <LastNameChoice name={`${id}-ln`} father={name} value={lastNameFrom} onChange={setLastNameFrom} labels={LAST_NAME_LABELS} />
        <p className="gf-hint rs-live" aria-live="polite">
          {full && (
            <>
              Student’s full name: <b>{full}</b>
            </>
          )}
        </p>
        <FieldError id={errId} message={bad ? "Type the student’s name and all three of the father’s names." : undefined} />
        <ContinuePill type="submit">Continue</ContinuePill>
      </form>
    </>
  )
}

export function ClassQuestion({
  id,
  first,
  saved,
  year,
  years,
  onYear,
  onPick,
}: {
  id: string
  first: string
  saved?: LeadClass
  year: number
  years: readonly number[]
  onYear: (year: number) => void
  onPick: (cls: LeadClass) => void
}) {
  const [picked, setPicked] = useState<LeadClass | undefined>(saved)
  const [yearOpen, setYearOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const pick = (cls: LeadClass) => {
    setPicked(cls)
    onPick(cls)
  }
  return (
    <div role="group" aria-labelledby={`${id}-title`} className="rs-col">
      <QuestionTitle id={`${id}-title`}>{`Which class is ${first} joining?`}</QuestionTitle>
      <div className="rs-year">
        <Icon name="calendar" size={20} />
        <span id={`${id}-yl`}>
          Joining in <b>{year}</b>
        </span>
        <TextLink aria-expanded={yearOpen} aria-controls={`${id}-years`} aria-describedby={`${id}-yl`} onClick={() => setYearOpen((o) => !o)}>
          Change Year
        </TextLink>
      </div>
      {yearOpen && (
        <div id={`${id}-years`}>
          <ChoiceTiles
            name={`${id}-year`}
            layout="two"
            legend={<span className="sr-only">Year of enrolment</span>}
            options={years.map((y, j) => ({ value: String(y), label: `${y} · ${j === 0 ? "This year" : "Next year"}` }))}
            value={String(year)}
            onChange={(v) => {
              onYear(Number(v))
              setYearOpen(false)
            }}
          />
        </div>
      )}
      <DefaultTile label={POPULAR_CLASS} tagline="Most parents choose" pressed={picked === POPULAR_CLASS} onClick={() => pick(POPULAR_CLASS)} />
      {picked && picked !== POPULAR_CLASS && <DefaultTile label={picked} pressed onClick={() => pick(picked)} />}
      <ContinuePill variant="ghost" aria-haspopup="dialog" onClick={() => setSheet(true)}>
        Choose another class
      </ContinuePill>
      <Sheet open={sheet} onOpenChange={setSheet} placement="centre" title="Choose a class" closeLabel="Close">
        <ClassPicker
          label="School level"
          levels={CLASS_LEVELS}
          picked={picked}
          defaultLevel={1}
          onPick={(cls) => {
            setSheet(false)
            window.setTimeout(() => pick(cls), 200)
          }}
        />
      </Sheet>
    </div>
  )
}

export function GenderQuestion({ id, first, saved, onPick }: { id: string; first: string; saved?: StudentGender; onPick: (v: StudentGender) => void }) {
  const [value, setValue] = useState<string | null>(saved ?? null)
  const pick = (v: string) => onPick(v as StudentGender)
  return (
    <div onClick={again(saved, pick)}>
      <ChoiceTiles
        name={`${id}-gender`}
        layout="two"
        big
        legend={<QuestionTitle>{`Is ${first} a boy or a girl?`}</QuestionTitle>}
        options={STUDENT_GENDERS.map((o) => ({ value: o, label: o }))}
        value={value}
        onChange={(v) => {
          setValue(v)
          pick(v)
        }}
      />
    </div>
  )
}

export function BoardQuestion({ id, first, saved, onPick }: { id: string; first: string; saved?: DayOrBoarding; onPick: (v: DayOrBoarding) => void }) {
  const [value, setValue] = useState<string | null>(saved ?? null)
  const pick = (v: string) => onPick(v as DayOrBoarding)
  return (
    <div onClick={again(saved, pick)}>
      <ChoiceTiles
        name={`${id}-board`}
        layout="two"
        big
        legend={<QuestionTitle>{`Will ${first} be a day or a boarding student?`}</QuestionTitle>}
        options={["Day", "Boarding"].map((o) => ({ value: o, label: o }))}
        value={value}
        onChange={(v) => {
          setValue(v)
          pick(v)
        }}
      />
    </div>
  )
}

export function SchoolQuestion({
  id,
  first,
  saved,
  needsCountry,
  onDone,
  onNotKnown,
}: {
  id: string
  first: string
  saved?: SchoolAnswer
  // Check-in (#511): an older Outside Tanzania school on file with no country yet.
  needsCountry?: boolean
  onDone: (s: SchoolAnswer) => void
  onNotKnown: () => void
}) {
  const known = saved && !("notKnown" in saved) ? saved : undefined
  const [name, setName] = useState(known?.name ? known.name.toUpperCase() : "")
  const [type, setType] = useState<"private" | "public" | null>(known?.type ?? null)
  const [region, setRegion] = useState(known?.region ?? "")
  const [country, setCountry] = useState(known?.region === OUTSIDE_TANZANIA ? (known.country ?? "") : "")
  // The school staff last picked a country for (it counts for that school only), and whether they typed in the box.
  const [countryPickedFor, setCountryPickedFor] = useState<string | null>(null)
  const [countryTouched, setCountryTouched] = useState(false)
  const countryOptions = useMemo(() => countriesSavedFirst(known?.country).map((c) => ({ value: c, label: c })), [known?.country])
  const [error, setError] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  const focusTimer = useRef(0)
  const errId = `${id}-error`
  const regionId = `${id}-region`
  const countryId = `${id}-country`
  const out = region === OUTSIDE_TANZANIA

  useEffect(() => () => window.clearTimeout(focusTimer.current), [])

  // Where the planned focus goes, and the box it may come from.
  const focusPlan = useRef<{ to: string; from?: string }>({ to: "" })

  function focusLater(targetId: string, onlyIfActiveId?: string) {
    window.clearTimeout(focusTimer.current)
    focusPlan.current = { to: targetId, from: onlyIfActiveId }
    focusTimer.current = window.setTimeout(() => {
      if (onlyIfActiveId && document.activeElement?.id !== onlyIfActiveId) return
      formRef.current?.querySelector<HTMLInputElement>(`[id="${targetId}"]`)?.focus({ preventScroll: true })
    }, 330)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const n = cleanName(name)
    // As the database and the Family page: two letters at least.
    if (n.length < 2) return setError("Type the school’s name.")
    if (!type) return setError("Choose private or public.")
    if (!region) return setError("Choose the region from the list.")
    // The lead's rule (#511): another school or a new region abroad needs its country picked, the saved one again
    // included; private or public alone, or an old school abroad with no country left as it is, needs none.
    const need = countryNeed({ saved: known, name: n, region, country, pickedFor: countryPickedFor, touched: countryTouched })
    if (need === "missing") return setError("Choose the country from the list.")
    if (need === "again") return setError("Choose the country again for the new school.")
    onDone({ name: n, type, region, ...(out && country ? { country } : {}) })
  }

  return (
    <>
      <QuestionTitle htmlFor={`${id}-name`}>{`Which school is ${first} coming from?`}</QuestionTitle>
      <Hint>The school they attended last.</Hint>
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        // Typing in the country box counts as changing it, even when the text matches no country yet.
        onInput={(e) => {
          if (e.target instanceof HTMLElement && e.target.id === countryId) setCountryTouched(true)
        }}
        // Staff who move to another box themselves keep their place: the school's name, or a list's search box
        // (its events reach the form through the portal). The planned box, and the region box the list hands
        // focus back to as it closes, don't cancel it.
        onFocusCapture={(e) => {
          const t = e.target
          if (!(t instanceof HTMLInputElement) || t.type === "radio" || t.type === "checkbox") return
          if (t.id !== focusPlan.current.to && t.id !== focusPlan.current.from) window.clearTimeout(focusTimer.current)
        }}
        className="rs-col"
      >
        <CapitalsBox
          id={`${id}-name`}
          placeholder="School name"
          aria-label="School name"
          value={name}
          invalid={!!error && cleanName(name).length < 2}
          aria-describedby={errId}
          onValueChange={(v) => {
            setName(v)
            setError("")
          }}
        />
        <GuidedReveal open={cleanName(name).length > 1}>
          <ChoiceTiles
            name={`${id}-type`}
            layout="two"
            legend={<Hint>Is it a private or a public school?</Hint>}
            options={[
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
            ]}
            value={type}
            onChange={(v) => {
              setType(v as "private" | "public")
              setError("")
              if (!region) focusLater(regionId)
            }}
          />
        </GuidedReveal>
        <GuidedReveal open={!!type}>
          <Hint>Which region is the school in?</Hint>
          <TypeAheadField
            id={regionId}
            options={REGION_OPTIONS}
            pinned={OUTSIDE_TANZANIA}
            value={region}
            invalid={!!error && !region}
            aria-describedby={errId}
            lead={() => <GuidedIcon name="pin" small />}
            labels={REGION_LABELS}
            onValueChange={(v, how) => {
              setRegion(v)
              // Only a region in Tanzania clears the country: retyping Outside Tanzania keeps it.
              if (v !== "" && v !== OUTSIDE_TANZANIA) setCountry("")
              setError("")
              if (v === OUTSIDE_TANZANIA && how !== "type") focusLater(countryId, regionId)
            }}
          />
          <GuidedReveal open={out}>
            {needsCountry && !country && (
              <Note>This school is Outside Tanzania, with no country saved yet. Choose the country, or Not known yet keeps the school as it is.</Note>
            )}
            <Hint>Which country is the school in?</Hint>
            <TypeAheadField
              id={countryId}
              options={countryOptions}
              pinned={known?.country}
              value={country}
              invalid={!!error && out}
              aria-describedby={errId}
              lead={(v) => (v ? flag(v) : <GuidedIcon name="globe" small />)}
              optionLead={flag}
              labels={COUNTRY_LABELS}
              onValueChange={(v) => {
                setCountry(v)
                setCountryTouched(true)
                if (v) setCountryPickedFor(schoolKey(name, region))
                setError("")
              }}
            />
          </GuidedReveal>
        </GuidedReveal>
        <FieldError id={errId} message={error} />
        {/* An old school abroad with no country: Continue shows once private or public changes, the name kept. */}
        <GuidedReveal open={!!region && (!out || !!country || (!!needsCountry && type !== known?.type && sameSchoolName(name, known?.name)))}>
          <ContinuePill type="submit">Continue</ContinuePill>
        </GuidedReveal>
        <TextLink className="rs-nk" onClick={onNotKnown}>
          Not known yet
        </TextLink>
      </form>
    </>
  )
}

export type SiblingChoice = { key: number; name: string; father: string; same: boolean }

export function SiblingQuestion({
  id,
  first,
  father,
  choices,
  saved,
  onPick,
}: {
  id: string
  first: string
  father: string
  choices: SiblingChoice[]
  saved?: string
  // Returns false when the pick waits on a sheet, so the radio shows as chosen until the sheet answers.
  onPick: (value: string, clear: () => void) => void
}) {
  const [value, setValue] = useState<string | null>(saved ?? null)
  const same = choices.filter((c) => c.same)
  const rest = choices.filter((c) => !c.same)
  const pick = (v: string) => onPick(v, () => setValue(saved ?? null))
  const title = same.length
    ? `${first} and ${list(same.map((c) => c.name.split(" ")[0]))} have the same father’s name. Are they siblings?`
    : `Is ${first} a sibling of another student here?`
  return (
    <div onClick={again(saved, pick)}>
      <ChoiceTiles
        name={`${id}-sib`}
        legend={
          <>
            <QuestionTitle>{title}</QuestionTitle>
            <Hint>
              {same.length
                ? `Father: ${father}. Two different men can have the same name, so check with the family.`
                : "Siblings have the same father. A relative’s or a friend’s child is not a sibling."}
            </Hint>
          </>
        }
        options={[
          ...same.map((c) => ({ value: String(c.key), label: `Yes, sibling of ${c.name}`, description: "The same father" })),
          ...rest.map((c) => ({ value: String(c.key), label: `Sibling of ${c.name}`, description: `Father: ${c.father}` })),
          {
            value: "none",
            label: "Not a sibling",
            description: same.length ? "A different father with the same name, or a relative’s child" : "A relative’s or a friend’s child",
          },
        ]}
        value={value}
        onChange={(v) => {
          setValue(v)
          pick(v)
        }}
      />
    </div>
  )
}

/** Two fathers' names side by side. */
function Compare({ a, b }: { a: { label: string; name: string }; b: { label: string; name: string } }) {
  return (
    <div className="rs-cmp">
      {[a, b].map((x) => (
        <div key={x.label}>
          <small>{x.label}</small>
          <b>{x.name}</b>
        </div>
      ))}
    </div>
  )
}

export type NamePair = { mine: { first: string; father: string }; theirs: { first: string; father: string } }

export function TypoSheet({ open, pair, onAnswer, onClose }: { open: boolean; pair: NamePair | null; onAnswer: (v: "mine" | "theirs" | "different") => void; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(null)
  if (!pair) return null
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} placement="centre" title="One name, or two?" closeLabel="Close">
      <div className="rs-col">
        <Compare a={{ label: `${pair.mine.first}’s father`, name: pair.mine.father }} b={{ label: `${pair.theirs.first}’s father`, name: pair.theirs.father }} />
        <p className="rs-centre">These two names are almost the same. Is it one name with a typing mistake, or are they two different names?</p>
        <ChoiceTiles
          name="rs-typo"
          legend={<span className="sr-only">One name, or two?</span>}
          options={[
            { value: "mine", label: "A typing mistake", description: `The right name is ${pair.mine.father}` },
            { value: "theirs", label: "A typing mistake", description: `The right name is ${pair.theirs.father}` },
            { value: "different", label: "Two different names", description: "Send a Sibling request to the Admissions Manager" },
          ]}
          value={value}
          onChange={(v) => {
            setValue(v)
            window.setTimeout(() => onAnswer(v as "mine" | "theirs" | "different"), PICK_MS)
          }}
        />
      </div>
    </Sheet>
  )
}

export function MismatchSheet({
  open,
  pair,
  lowerFee,
  onRequest,
  onNotSiblings,
  onClose,
}: {
  open: boolean
  pair: NamePair | null
  lowerFee: string | null
  onRequest: (note: string) => void
  onNotSiblings: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const errorId = useId()
  if (!pair) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      placement="centre"
      title="The fathers’ names don’t match"
      closeLabel="Close"
      foot={
        <>
          <Button size="wide" chevron onClick={() => (note.trim() ? onRequest(note) : setError("Write what proof the family will bring."))}>
            Request the discount
          </Button>
          <Button variant="ghost" size="wide" onClick={onNotSiblings}>
            They are not siblings
          </Button>
        </>
      }
    >
      <div className="rs-col">
        <Compare a={{ label: `${pair.mine.first}’s father`, name: pair.mine.father }} b={{ label: `${pair.theirs.first}’s father`, name: pair.theirs.father }} />
        <p className="rs-centre">
          The 10% sibling discount needs proof that they are siblings.
          {lowerFee && (
            <>
              {" "}
              It would go to <b>{lowerFee}</b>, who has the lower fee.
            </>
          )}
        </p>
        <Note>
          Ask the family to bring proof. If the children share only their mother and she has full custody, ask for both birth certificates. The
          mother’s name must match on both.
        </Note>
        {/* The database refuses a Sibling request without a note on the proof (#310). */}
        <Field
          size="compact"
          alignStart
          placeholder="Note for the Admissions Manager"
          aria-label="Note for the Admissions Manager"
          autoComplete="off"
          maxLength={1000}
          value={note}
          invalid={!!error}
          aria-describedby={errorId}
          onChange={(e) => {
            setNote(e.target.value)
            setError("")
          }}
        />
        <FieldError id={errorId} message={error} />
      </div>
    </Sheet>
  )
}

const childLine = (c: KnownContact["children"][number]) => `${c.studentName}, ${c.className}, ${c.status}`

type Lookup = { phone: string; state: "checking" | "none" | "unavailable" } | { phone: string; state: "found"; contacts: KnownContact[] }

/** Looks the custodian's number up once it is complete, after a short pause. */
function useFamilyLookup(phone: string, whatsapp: string, enabled: boolean): Lookup | null {
  const [found, setFound] = useState<Lookup | null>(null)
  const latest = useRef("")
  const key = `${digits(phone)}|${digits(whatsapp)}`
  useEffect(() => {
    latest.current = key
    if (!enabled || !phoneOk(phone)) return
    const timer = window.setTimeout(async () => {
      let next: Lookup
      try {
        const r = await findCustodianFamily(phone, whatsapp.trim() || null)
        next = r.status === "found" ? { phone: key, state: "found", contacts: r.contacts } : { phone: key, state: r.status === "unavailable" ? "unavailable" : "none" }
      } catch {
        next = { phone: key, state: "unavailable" }
      }
      if (latest.current === key) setFound(next)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [key, enabled, phone, whatsapp])
  if (!enabled || !phoneOk(phone)) return null
  return found && found.phone === key ? found : { phone: key, state: "checking" }
}

export function CustodianQuestion({
  id,
  names,
  father,
  first,
  saved,
  canCheck,
  otherFather,
  prefill,
  onDone,
}: {
  id: string
  names: string
  father: string
  // The first household's custodian, offered again from the second household on.
  first: { name: string } | null
  saved?: Custodian
  // Staff who may view leads get the number checked against families on file.
  canCheck: boolean
  // A child here whose father is another man, by first name: then the father can't be everyone's custodian.
  otherFather: string | null
  // Check-in (#309): the parent the Admission form gave, offered first with their number and relationship.
  prefill?: GivenContact | null
  onDone: (c: Custodian) => void
}) {
  // Check-in opens on The father or Someone else according to what the Admission form gave (#511, prototype v52).
  const formDad = prefill?.relationship === "Father"
  const given = prefill && !saved ? givenRelationship(prefill) : null
  const formNumber = (on: boolean) => (prefill && on === formDad ? { phone: prefill.contact.phone, whatsapp: prefill.contact.whatsapp ?? "" } : { phone: "", whatsapp: "" })
  const [who, setWho] = useState<"father" | "else" | null>(
    saved ? (saved.kind === "father" ? "father" : "else") : prefill ? (formDad ? "father" : "else") : null,
  )
  const [same, setSame] = useState<boolean | null>(saved ? saved.kind === "same" : null)
  const [phone, setPhone] = useState(saved && saved.kind !== "same" ? saved.phone : prefill ? formNumber(formDad).phone : "")
  const [whatsapp, setWhatsapp] = useState(saved && saved.kind !== "same" ? saved.whatsapp : prefill ? formNumber(formDad).whatsapp : "")
  const [waOpen, setWaOpen] = useState(!!whatsapp)
  const savedContact = saved?.kind === "known" || saved?.kind === "father" ? saved.contact : undefined
  // Which person on file staff said it is, by contact id, or "else" for someone else. A changed number asks again.
  const [picked, setPicked] = useState<string | null>(saved ? (savedContact ? savedContact.id : saved.kind === "new" || saved.kind === "father" ? "else" : null) : null)
  const [name, setName] = useState<PersonName>(saved?.kind === "new" ? saved.name : EMPTY_PERSON)
  const [rel, setRel] = useState<RelationshipChoice | null>(saved && saved.kind !== "father" ? saved.relationship : (given?.choice ?? null))
  const [desc, setDesc] = useState(saved && saved.kind !== "father" ? saved.description : (given?.description ?? ""))
  const [error, setError] = useState("")
  const errId = `${id}-error`
  const formRef = useRef<HTMLFormElement>(null)
  const waRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const focusTimer = useRef(0)
  // Each choice keeps its own numbers: the father's number never becomes someone else's, and back again.
  const numbersOf = useRef<Partial<Record<"father" | "else", { phone: string; whatsapp: string; rel: RelationshipChoice | null; desc: string }>>>({})

  useEffect(() => () => window.clearTimeout(focusTimer.current), [])

  const dad = who === "father"
  const other = who === "else"
  const reuse = other && !!first && same === true
  const askPhone = dad || (other && (!first || same === false))
  // The form's own parent on the form's number: kept as the record holds them, so nothing is looked up and no name is typed.
  const formParent = !!prefill && who !== null && dad === formDad && phoneOk(phone) && digits(phone) === digits(prefill.contact.phone)
  const lookup = useFamilyLookup(phone, whatsapp, canCheck && askPhone && !formParent)
  const onFile = lookup?.state === "found" ? lookup.contacts : []
  const contact = formParent ? prefill.contact : onFile.find((c) => c.id === picked)
  const needName = other && !reuse && !formParent && (!first || same === false) && !contact
  const nameOk = Object.values(name).every((v) => v.trim())
  const famSettled = formParent || onFile.length === 0 || picked === "else" || !!contact
  const phoneReady = phoneOk(phone) && famSettled && (formParent || lookup?.state !== "checking")
  // Only what shows counts: a name or number left from another choice, now hidden, never unlocks the relationship.
  const relReady = other && (reuse || (askPhone && phoneReady && (!!contact || formParent || nameOk)))
  const options: readonly RelationshipChoice[] = reuse ? SAME_RELATIONSHIPS : FIRST_RELATIONSHIPS
  const relOk = !!rel && options.includes(rel) && (rel !== "Other" || desc.trim().length > 0)
  const ready = dad ? phoneReady : relReady && relOk

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!who) return setError("Choose who the custodian is.")
    if (other && first && same === null) return setError(`Say whether it is ${first.name} or someone else.`)
    if (!reuse && !phoneOk(phone)) return setError("Type the mobile number in full, for example 0712 345 678.")
    if (!reuse && whatsapp.trim() && !phoneOk(whatsapp)) return setError("Type the WhatsApp number in full, or leave it empty.")
    if (dad) {
      if (otherFather) return setError(`${otherFather}’s father is another man, so the father can’t be the custodian of them all. Choose Someone else instead.`)
      if (!famSettled) return setError("Say whether it is the same person.")
      return onDone({ kind: "father", phone: phone.trim(), whatsapp: whatsapp.trim(), contact })
    }
    if (!relReady || !relOk) return setError("Add the custodian’s name and their relationship.")
    if (reuse) return onDone({ kind: "same", relationship: rel!, description: desc.trim() })
    if (contact) return onDone({ kind: "known", contact, phone: phone.trim(), whatsapp: whatsapp.trim(), relationship: rel!, description: desc.trim() })
    onDone({ kind: "new", name: { firstName: cleanName(name.firstName), middleName: cleanName(name.middleName), lastName: cleanName(name.lastName) }, phone: phone.trim(), whatsapp: whatsapp.trim(), relationship: rel!, description: desc.trim() })
  }

  function pickWho(next: string) {
    const chosen = next === "father" ? "father" : "else"
    const on = chosen === "father"
    if (who && who !== chosen) numbersOf.current[who] = { phone, whatsapp, rel, desc }
    setWho(chosen)
    setRel(null)
    setDesc("")
    setPicked(null)
    setSame(null)
    setError("")
    // The form's number belongs to the form's answer: it comes back with it, and goes with the other.
    const kept = numbersOf.current[chosen]
    const back = kept ?? formNumber(on)
    setPhone(back.phone)
    setWhatsapp(back.whatsapp)
    setWaOpen(!!back.whatsapp)
    // The relationship goes with the person too: back to a choice, staff's own answer comes back, not the form's.
    if (kept) {
      setRel(kept.rel)
      setDesc(kept.desc)
    } else if (prefill) {
      const r = on === formDad ? givenRelationship(prefill) : null
      setRel(r?.choice ?? null)
      setDesc(r?.description ?? "")
    }
    window.clearTimeout(focusTimer.current)
    focusTimer.current = window.setTimeout(() => {
      if (on) phoneRef.current?.focus({ preventScroll: true })
      else if (!first && !(prefill && !formDad)) formRef.current?.querySelector<HTMLInputElement>(`[id="${id}-cn-firstName"]`)?.focus({ preventScroll: true })
    }, 330)
  }

  return (
    <>
      <QuestionTitle id={`${id}-title`}>{`Who is the custodian of ${names}?`}</QuestionTitle>
      <Hint>The custodian is responsible for school matters, and for paying the school fees.</Hint>
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        onInput={() => setError("")}
        // Staff who move to a box themselves keep their place: the focus planned for when the boxes open is dropped.
        onFocusCapture={(e) => {
          if (e.target instanceof HTMLInputElement && e.target.type !== "radio" && e.target.type !== "checkbox") window.clearTimeout(focusTimer.current)
        }}
        className="rs-col"
      >
        <ChoiceTiles
          name={`${id}-who-kind`}
          legend={<span className="sr-only">Who is the custodian</span>}
          value={who}
          onChange={pickWho}
          options={[
            { value: "father", label: "The father", description: father },
            { value: "else", label: "Someone else", description: "Mother, guardian or another person" },
          ]}
        />
        {first && (
          <GuidedReveal open={other}>
            <ChoiceTiles
              name={`${id}-who`}
              legend={<span className="sr-only">Who is the custodian?</span>}
              options={[
                { value: "same", label: first.name, description: `The same person as before, with their own relationship to ${names}` },
                { value: "else", label: "Someone else", description: "Take their own name and phone number" },
              ]}
              value={same === null ? null : same ? "same" : "else"}
              onChange={(v) => {
                setSame(v === "same")
                setRel(null)
              }}
            />
          </GuidedReveal>
        )}
        <GuidedReveal open={needName}>
          <PersonNameBoxes id={`${id}-cn`} aria-labelledby={`${id}-title`} labels={NAME_LABELS} value={name} onChange={setName} />
        </GuidedReveal>
        {prefill && (
          <GuidedReveal open={formParent && other}>
            <PersonNameBoxes id={`${id}-fp`} aria-labelledby={`${id}-title`} labels={NAME_LABELS} value={personParts(prefill.contact.fullName)} readOnly />
          </GuidedReveal>
        )}
        <GuidedReveal open={askPhone}>
          <Field
            ref={phoneRef}
            icon="phone"
            inputMode="tel"
            placeholder="Mobile number, e.g. 0712 345 678"
            aria-label="Custodian’s mobile number"
            autoComplete="off"
            value={phone}
            aria-describedby={errId}
            onChange={(e) => {
              setPhone(e.target.value)
              setPicked(null)
            }}
          />
          <GuidedReveal open={waOpen}>
            <Field ref={waRef} icon="phone" inputMode="tel" placeholder="WhatsApp number" aria-label="WhatsApp number" autoComplete="off" value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value)
                setPicked(null)
              }}
            />
          </GuidedReveal>
          {!waOpen && (
            <TextLink
              className="rs-nk"
              onClick={() => {
                setWaOpen(true)
                window.clearTimeout(focusTimer.current)
                focusTimer.current = window.setTimeout(() => waRef.current?.focus({ preventScroll: true }), 320)
              }}
            >
              Their WhatsApp number is different
            </TextLink>
          )}
        </GuidedReveal>
        <GuidedReveal open={askPhone && onFile.length > 0}>
          {onFile.length === 1 ? (
            <Note>
              This number is on file for <b>{onFile[0].fullName}</b>
              {onFile[0].children.length === 0
                ? ". "
                : `, with ${onFile[0].children.length === 1 ? "one child" : `${onFile[0].children.length} children`} here: ${onFile[0].children.map(childLine).join("; ")}. `}
              Ask if they are the same person.
            </Note>
          ) : (
            onFile.length > 1 && <Note>{`This number is on file for ${list(onFile.map((c) => c.fullName))}. Ask which one they are, if any.`}</Note>
          )}
          {onFile.length > 0 && (
            <ChoiceTiles
              name={`${id}-fam`}
              layout={onFile.length === 1 ? "two" : "rows"}
              legend={<span className="sr-only">Is it the same person?</span>}
              options={
                onFile.length === 1
                  ? [
                      { value: onFile[0].id, label: "Same person" },
                      { value: "else", label: "Someone else" },
                    ]
                  : [
                      ...onFile.map((c) => ({ value: c.id, label: c.fullName, description: c.children.length ? c.children.map(childLine).join("; ") : "No children here" })),
                      { value: "else", label: "Someone else" },
                    ]
              }
              value={picked !== null && (picked === "else" || contact) ? picked : null}
              onChange={(v) => {
                setPicked(v)
                setRel(null)
              }}
            />
          )}
        </GuidedReveal>
        <GuidedReveal open={relReady}>
          <ChoiceTiles
            name={`${id}-rel`}
            layout="three"
            legend={<Hint>{`Relationship to ${names}`}</Hint>}
            options={options.map((o) => ({ value: o, label: o }))}
            value={rel && options.includes(rel) ? rel : null}
            onChange={(v) => setRel(v as RelationshipChoice)}
          />
          <GuidedReveal open={rel === "Other"}>
            <Field placeholder={`Who they are to ${names}, e.g. aunt`} aria-label={`Who they are to ${names}`} autoComplete="off" maxLength={60} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </GuidedReveal>
        </GuidedReveal>
        <FieldError id={errId} message={error} />
        <GuidedReveal open={ready}>
          <ContinuePill type="submit">Continue</ContinuePill>
        </GuidedReveal>
      </form>
    </>
  )
}

export function OnFileQuestion({
  id,
  first,
  onFileName,
  admissionNumber,
  father,
  saved,
  onPick,
}: {
  id: string
  first: string
  onFileName: string
  admissionNumber: string
  father: string
  saved?: boolean
  // A Yes may wait on a sheet: `clear` puts the choice back when the sheet is closed without an answer.
  onPick: (yes: boolean, clear: () => void) => void
}) {
  const savedValue = saved === undefined ? undefined : saved ? "yes" : "no"
  const [value, setValue] = useState<string | null>(savedValue ?? null)
  const pick = (v: string) => onPick(v === "yes", () => setValue(savedValue ?? null))
  return (
    <div onClick={again(savedValue, pick)}>
      <ChoiceTiles
        name={`${id}-onfile`}
        legend={
          <>
            <QuestionTitle>{`${first} and ${onFileName.split(" ")[0]} have the same father’s name. Are they siblings?`}</QuestionTitle>
            <Hint>{`Father: ${father}. Two different men can have the same name, so check with the family.`}</Hint>
          </>
        }
        options={[
          { value: "yes", label: `Yes, sibling of ${onFileName}`, description: `${admissionNumber} · already on file` },
          { value: "no", label: "Not a sibling", description: "A different father with the same name, or a relative’s child" },
        ]}
        value={value}
        onChange={(v) => {
          setValue(v)
          pick(v)
        }}
      />
    </div>
  )
}

export function BroughtQuestion({ id, who, people, saved, onDone }: { id: string; who: string; people: { name: string; person: number }[]; saved?: Brought; onDone: (b: Brought) => void }) {
  const savedElse = saved?.who === "else" ? saved : undefined
  const [value, setValue] = useState<string | null>(saved ? (saved.who === "else" ? "else" : String(saved.person)) : null)
  const [name, setName] = useState(savedElse?.name ?? "")
  const [phone, setPhone] = useState(savedElse?.phone ?? "")
  const [rel, setRel] = useState(savedElse?.relationship ?? "")
  const [error, setError] = useState("")
  const errId = `${id}-error`
  const savedValue = saved && saved.who === "person" ? String(saved.person) : undefined
  const pick = (v: string) => {
    if (v !== "else") window.setTimeout(() => onDone({ who: "person", person: Number(v) }), PICK_MS)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!hasTwoNames(name)) return setError("Type their full name, at least two names.")
    if (phone.trim() && !phoneOk(phone)) return setError("Type the phone number in full, or leave it empty.")
    onDone({ who: "else", name: cleanName(name), phone: phone.trim(), relationship: rel.trim() })
  }

  return (
    <form noValidate onSubmit={submit} onInput={() => setError("")} className="rs-col" onClick={again(savedValue, pick)}>
      <ChoiceTiles
        name={`${id}-who`}
        legend={
          <>
            <QuestionTitle>{`Who brought ${who} today?`}</QuestionTitle>
            <Hint>Kept on each student’s record, separate from the custodian.</Hint>
          </>
        }
        options={[
          ...people.map((p) => ({ value: String(p.person), label: p.name, description: "A custodian" })),
          { value: "else", label: "Someone else", description: "A relative, a neighbour or a driver" },
        ]}
        value={value}
        onChange={(v) => {
          setValue(v)
          pick(v)
        }}
      />
      <GuidedReveal open={value === "else"}>
        <FullNameBox placeholder="Their full name" aria-label="Full name of the person who brought the students" value={name} onValueChange={setName} invalid={!!error && !hasTwoNames(name)} aria-describedby={errId} />
        <Field icon="phone" inputMode="tel" placeholder="Their phone number" aria-label="Their phone number" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Field placeholder="Who they are to the family, e.g. uncle" aria-label="Who they are to the family" autoComplete="off" maxLength={60} value={rel} onChange={(e) => setRel(e.target.value)} />
        <FieldError id={errId} message={error} />
        <ContinuePill type="submit">Continue</ContinuePill>
      </GuidedReveal>
    </form>
  )
}

function codeProblem(lookup: ReferralLookup): string {
  switch (lookup.status) {
    case "unavailable":
      return "The code could not be checked just now. Try again, or choose No code and add it on the student’s record later."
    case "found":
      return "This code belongs to a retired Marketing Agent record. Correct it, or choose No code."
    default:
      return "No Marketing Agent or Promo code has this code. Correct it, or choose No code."
  }
}

export function CodeQuestion({ id, saved, onDone }: { id: string; saved?: string; onDone: (code: string) => void }) {
  const has = saved !== undefined && saved !== "none"
  const [none, setNone] = useState(saved === "none")
  const [typing, setTyping] = useState(has)
  const [code, setCode] = useState(has ? saved : "")
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(false)
  // Counts every change to the answer: a check whose answer arrives after one is ignored.
  const attempt = useRef(0)
  const errId = `${id}-error`
  const inputId = useId()
  // The codes to pick from, read once the box shows.
  const [codes, setCodes] = useState<{ state: "loading" | "ready" | "unavailable"; options: CodeOption[] }>({ state: "loading", options: [] })

  useEffect(() => {
    if (!typing) return
    let live = true
    listCodesToPick()
      .then((listed) => {
        if (live) setCodes(listed.status === "ok" ? { state: "ready", options: listed.codes } : { state: "unavailable", options: [] })
      })
      .catch(() => {
        if (live) setCodes({ state: "unavailable", options: [] })
      })
    return () => {
      live = false
    }
  }, [typing])

  // Continue checks the code itself, so pressing it straight after typing waits for the answer.
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (checking) return
    const v = formatCode(code)
    if (v.length < 3) return setError("Type the code, or choose No code.")
    const mine = ++attempt.current
    setChecking(true)
    let lookup: ReferralLookup
    try {
      lookup = await lookUpReferralCode(v)
    } catch {
      lookup = { status: "unavailable" }
    }
    if (mine !== attempt.current) return
    setChecking(false)
    const found = usableCode(lookup)
    if (!found) return setError(codeProblem(lookup))
    onDone(found.code)
  }

  return (
    <>
      <QuestionTitle>Does the family have a Discount code?</QuestionTitle>
      <Hint>It takes an amount off the interview fee. It never changes school fees.</Hint>
      <form noValidate onSubmit={submit} className="rs-col">
        <DefaultTile
          label="NO CODE"
          tagline="Nothing to enter"
          pressed={none}
          onClick={() => {
            attempt.current++
            setChecking(false)
            setNone(true)
            window.setTimeout(() => onDone("none"), PICK_MS)
          }}
        />
        <ContinuePill variant="ghost" onClick={() => setTyping(true)}>
          They have a code
        </ContinuePill>
        <GuidedReveal open={typing}>
          <CodePicker
            id={inputId}
            placeholder="Discount code, e.g. ABC-123"
            aria-label="Discount code"
            value={code}
            options={codes.options}
            listState={codes.state}
            invalid={!!error}
            aria-describedby={errId}
            onValueChange={(v) => {
              attempt.current++
              setChecking(false)
              setCode(v)
              setError("")
              setNone(false)
            }}
          />
          <Note>
            <span data-notice-version="staff_reminder">{STAFF_REMINDER}</span>
          </Note>
          <FieldError id={errId} message={error} />
          <ContinuePill type="submit" pending={checking}>
            Continue
          </ContinuePill>
        </GuidedReveal>
      </form>
    </>
  )
}

export function FeesQuestion({ answers, preview, onOk }: { answers: Answers; preview: FeePreview; onOk: () => void }) {
  const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`
  // A child on file in a year with no Fee schedule has no fee to show.
  const amount = (n: number | null) => (n === null ? "Not set" : tzs(n))
  const siblings = mentionsSiblings(answers, preview)
  const student = (r: FeePreview["rows"][number]): ReactNode => (
    <>
      <b>{r.name}</b>
      <small>{r.detail}</small>
    </>
  )
  return (
    <>
      <QuestionTitle>{siblings ? "Check the fees and the sibling discount" : "Check the fees"}</QuestionTitle>
      {siblings ? (
        <Table
          className="rs-fees"
          label="School fees and the sibling discount"
          rows={preview.rows}
          rowKey={(r) => r.key}
          columns={[
            { header: "Student", cell: student, rowHeader: true },
            { header: "School fee", cell: (r) => amount(r.fee), align: "end" },
            { header: "Discount", cell: (r) => <Tag tone={r.tone === "good" ? "ok" : r.tone === "wait" ? "wait" : "line"}>{r.why}</Tag> },
            // A tied row pays one or the other: the database picks which sibling pays full.
            { header: "Pays", cell: (r) => <b>{r.tied ? `${amount(r.pays)} or ${amount(r.fee)}` : amount(r.pays)}</b>, align: "end" },
          ]}
          total={["New students this year", "", "", tzs(preview.total)]}
        />
      ) : (
        <Table
          className="rs-fees"
          label="School fees"
          rows={preview.rows}
          rowKey={(r) => r.key}
          columns={[
            { header: "Student", cell: student, rowHeader: true },
            { header: "School fee", cell: (r) => <b>{amount(r.fee)}</b>, align: "end" },
          ]}
          total={["New student this year", tzs(preview.total)]}
        />
      )}
      {siblings && preview.together && <Note>Among siblings, the highest fee pays full and each other sibling gets the 10%. It stays that way whichever child pays first.</Note>}
      {siblings && preview.enrolledOnFile && (
        <Note>{`${preview.enrolledOnFile.split(" ")[0]} is already Enrolled, so that fee stays as it is. Siblings who register later get the 10%.`}</Note>
      )}
      <ContinuePill onClick={onOk}>Looks right</ContinuePill>
    </>
  )
}

/** The fee step when a linked child's fee could not be read: nothing to accept until it is. */
export function FeesUnread({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <Note tone="wait" icon="alert" role="alert">
        The fees could not be checked. Try again.
      </Note>
      <Button variant="ghost" size="wide" onClick={onRetry}>
        Try again
      </Button>
    </>
  )
}

export function SubmitQuestion({
  who,
  failure,
  pending,
  checkIn,
  onSubmit,
}: {
  who: string
  failure: ReactNode
  pending: boolean
  // Check-in (#309): the visit is recorded on students who are on file already.
  checkIn?: boolean
  onSubmit: () => void
}) {
  if (checkIn)
    return (
      <>
        <QuestionTitle>{`Record today’s visit for ${who}?`}</QuestionTitle>
        <Hint>Their status moves from Applied to Visited, and the new answers are saved on each record.</Hint>
        {failure && (
          <Note tone="wait" icon="alert" role="alert">
            {failure}
          </Note>
        )}
        <ContinuePill pending={pending} onClick={() => !pending && onSubmit()}>
          Record the visit
        </ContinuePill>
      </>
    )
  return (
    <>
      <QuestionTitle>{`Register ${who}?`}</QuestionTitle>
      <Hint>Each student gets an Admission Number, and today’s visit is recorded.</Hint>
      {failure && (
        <Note tone="wait" icon="alert" role="alert">
          {failure}
        </Note>
      )}
      <ContinuePill pending={pending} onClick={() => !pending && onSubmit()}>
        {pending ? "Registering…" : `Register ${who}`}
      </ContinuePill>
    </>
  )
}
