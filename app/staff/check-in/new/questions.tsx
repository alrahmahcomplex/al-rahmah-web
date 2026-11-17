"use client"

import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"

import {
  CodeBox,
  ContinuePill,
  FullNameBox,
  Hint,
  PersonNameBoxes,
  QuestionTitle,
  StudentNameBoxes,
  cleanName,
  formatCode,
  hasTwoNames,
  type PersonName,
  type StudentName,
} from "@/components/guided-form"
import {
  Button,
  ChipButtons,
  ChoiceTiles,
  DefaultTile,
  Field,
  FieldError,
  GuidedReveal,
  Note,
  Sheet,
  Switch,
  TabSwitch,
  Table,
  Tag,
  TextLink,
} from "@/components/kit"
import { Icon } from "@/components/icons"
import { STAFF_REMINDER } from "@/lib/referral-notice"
import type { DayOrBoarding, LeadClass } from "@/lib/services/leads"

import { lookUpReferralCode } from "../../applicants/[id]/referral-actions"
import { usableCode, type ReferralLookup } from "../../applicants/[id]/referral-outcome"
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
  type Answers,
  type Brought,
  type Custodian,
  type FeePreview,
  type KnownContact,
  type RelationshipChoice,
  type SchoolAnswer,
} from "./model"

// The questions of Register students (#308), each one open card of the
// guided stack. Words from prototype v38. The two sheets start afresh each
// time they open: their caller gives them a new key.

/** The prototype waits this long after a tap, so the chosen tile shows before the question folds. */
export const PICK_MS = 240

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const EMPTY_STUDENT: StudentName = { firstName: "", fatherFirst: "", fatherMiddle: "", fatherLast: "" }
const EMPTY_PERSON: PersonName = { firstName: "", middleName: "", lastName: "" }
const STUDENT_KEYS = ["firstName", "fatherFirst", "fatherMiddle", "fatherLast"] as const

/** A radio group that answers on a pick, and when the chosen option is pressed again after Change. */
function again(saved: string | undefined, onPick: (v: string) => void) {
  return (e: MouseEvent) => {
    const input = e.target as HTMLInputElement
    if (input.type === "radio" && input.checked && input.value === saved) onPick(input.value)
  }
}

export function NameQuestion({ id, next, saved, onDone }: { id: string; next: boolean; saved?: StudentName; onDone: (name: StudentName) => void }) {
  const [name, setName] = useState<StudentName>(saved ?? EMPTY_STUDENT)
  const [bad, setBad] = useState<keyof StudentName | null>(null)
  const titleId = `${id}-title`
  const errId = `${id}-error`
  const clean = (n: StudentName): StudentName => ({ firstName: cleanName(n.firstName), fatherFirst: cleanName(n.fatherFirst), fatherMiddle: cleanName(n.fatherMiddle), fatherLast: cleanName(n.fatherLast) })
  const v = clean(name)
  const full = [v.firstName, v.fatherFirst, v.fatherLast].filter(Boolean).join(" ")

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const missing = STUDENT_KEYS.find((k) => !v[k])
    if (missing) {
      setBad(missing)
      e.currentTarget.querySelector<HTMLInputElement>(`[id="${id}-${missing}"]`)?.focus()
      return
    }
    onDone(v)
  }

  return (
    <>
      <QuestionTitle id={titleId}>{next ? "What is the next student’s name?" : "What is the student’s name?"}</QuestionTitle>
      <Hint>As it is on the birth certificate.</Hint>
      <form noValidate onSubmit={submit}>
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
  const [level, setLevel] = useState(() => String(Math.max(1, CLASS_LEVELS.findIndex((l) => saved && l.classes.includes(saved)))))
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
        <TabSwitch
          label="School level"
          value={level}
          onChange={setLevel}
          tabs={CLASS_LEVELS.map((l, i) => ({
            value: String(i),
            label: l.label,
            panel: (
              <div className="rs-classes" data-n={l.classes.length}>
                {l.classes.map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    className="rs-class"
                    aria-pressed={cls === picked}
                    onClick={() => {
                      setSheet(false)
                      window.setTimeout(() => pick(cls), 200)
                    }}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            ),
          }))}
        />
      </Sheet>
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

export function SchoolQuestion({ id, first, saved, onDone, onNotKnown }: { id: string; first: string; saved?: SchoolAnswer; onDone: (s: SchoolAnswer) => void; onNotKnown: () => void }) {
  const known = saved && !("notKnown" in saved) ? saved : undefined
  const [name, setName] = useState(known?.name ?? "")
  const [type, setType] = useState<"private" | "public" | null>(known?.type ?? null)
  const [region, setRegion] = useState<string | null>(known?.region ?? null)
  const [find, setFind] = useState("")
  const [error, setError] = useState("")
  const t = find.trim().toLowerCase()
  const shown = (t ? REGIONS.filter((r) => r.toLowerCase().includes(t)) : REGIONS).slice(0, 8)
  if (region && !shown.includes(region)) shown.unshift(region)
  const errId = `${id}-error`

  function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim().replace(/\s+/g, " ")
    if (n.length < 3) return setError("Type the school’s name.")
    if (!type || !region) return setError("Choose private or public, and the region.")
    onDone({ name: n, type, region })
  }

  return (
    <>
      <QuestionTitle htmlFor={`${id}-name`}>{`Which school is ${first} coming from?`}</QuestionTitle>
      <Hint>The school they attended last.</Hint>
      <form noValidate onSubmit={submit} className="rs-col">
        <Field
          id={`${id}-name`}
          placeholder="School name"
          autoComplete="off"
          value={name}
          invalid={!!error && name.trim().length < 3}
          aria-describedby={errId}
          onChange={(e) => {
            setName(e.target.value)
            setError("")
          }}
        />
        <GuidedReveal open={name.trim().length > 2}>
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
            }}
          />
        </GuidedReveal>
        <GuidedReveal open={!!type}>
          <Hint>Which region is the school in?</Hint>
          <Field size="compact" placeholder="Type to find a region" aria-label="Find a region" autoComplete="off" value={find} onChange={(e) => setFind(e.target.value)} />
          {shown.length > 0 ? (
            <ChipButtons
              label="Regions"
              options={shown.map((r) => ({ value: r, label: r }))}
              value={region}
              onChange={(r) => {
                setRegion(r)
                setError("")
              }}
            />
          ) : (
            <Hint>No region by that name.</Hint>
          )}
        </GuidedReveal>
        <FieldError id={errId} message={error} />
        <GuidedReveal open={!!region}>
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
          <Button size="wide" chevron onClick={() => onRequest(note)}>
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
        <Field size="compact" alignStart placeholder="Note for the Admissions Manager (optional)" aria-label="Note for the Admissions Manager" autoComplete="off" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
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
  onDone: (c: Custodian) => void
}) {
  const [dad, setDad] = useState(saved?.kind === "father")
  const [same, setSame] = useState<boolean | null>(saved ? saved.kind === "same" : null)
  const [phone, setPhone] = useState(saved && saved.kind !== "same" ? saved.phone : "")
  const [whatsapp, setWhatsapp] = useState(saved && saved.kind !== "same" ? saved.whatsapp : "")
  const [waOpen, setWaOpen] = useState(!!whatsapp)
  const savedContact = saved?.kind === "known" || saved?.kind === "father" ? saved.contact : undefined
  // Which person on file staff said it is, by contact id, or "else" for someone else. A changed number asks again.
  const [picked, setPicked] = useState<string | null>(saved ? (savedContact ? savedContact.id : saved.kind === "new" || saved.kind === "father" ? "else" : null) : null)
  const [name, setName] = useState<PersonName>(saved?.kind === "new" ? saved.name : EMPTY_PERSON)
  const [rel, setRel] = useState<RelationshipChoice | null>(saved && saved.kind !== "father" ? saved.relationship : null)
  const [desc, setDesc] = useState(saved && saved.kind !== "father" ? saved.description : "")
  const [error, setError] = useState("")
  const errId = `${id}-error`
  const waRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)

  const other = !dad
  const reuse = other && !!first && same === true
  const askPhone = dad || (other && (!first || same === false))
  const lookup = useFamilyLookup(phone, whatsapp, canCheck && askPhone)
  const onFile = lookup?.state === "found" ? lookup.contacts : []
  const contact = onFile.find((c) => c.id === picked)
  const needName = other && !reuse && phoneOk(phone) && lookup?.state !== "checking" && (onFile.length === 0 || picked === "else")
  const nameOk = Object.values(name).every((v) => v.trim())
  const relReady = other && (reuse || !!contact || (needName && nameOk))
  const options: readonly RelationshipChoice[] = reuse ? SAME_RELATIONSHIPS : FIRST_RELATIONSHIPS
  const relOk = !!rel && options.includes(rel) && (rel !== "Other" || desc.trim().length > 0)
  const famSettled = onFile.length === 0 || picked === "else" || !!contact
  const ready = dad ? phoneOk(phone) && famSettled && lookup?.state !== "checking" : relReady && relOk

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!reuse && !phoneOk(phone)) return setError("Type the mobile number in full, for example 0712 345 678.")
    if (!reuse && whatsapp.trim() && !phoneOk(whatsapp)) return setError("Type the WhatsApp number in full, or leave it empty.")
    if (dad) {
      if (otherFather) return setError(`${otherFather}’s father is another man, so the father can’t be the custodian of them all. Turn off the switch and choose the custodian.`)
      if (!famSettled) return setError("Say whether it is the same person.")
      return onDone({ kind: "father", phone: phone.trim(), whatsapp: whatsapp.trim(), contact })
    }
    if (!relReady || !relOk) return setError("Add the custodian’s name and their relationship.")
    if (reuse) return onDone({ kind: "same", relationship: rel!, description: desc.trim() })
    if (contact) return onDone({ kind: "known", contact, phone: phone.trim(), whatsapp: whatsapp.trim(), relationship: rel!, description: desc.trim() })
    onDone({ kind: "new", name: { firstName: cleanName(name.firstName), middleName: cleanName(name.middleName), lastName: cleanName(name.lastName) }, phone: phone.trim(), whatsapp: whatsapp.trim(), relationship: rel!, description: desc.trim() })
  }

  return (
    <>
      <QuestionTitle id={`${id}-title`}>{`Who is the custodian of ${names}?`}</QuestionTitle>
      <Hint>The custodian is responsible for school matters, and for paying the school fees.</Hint>
      <form noValidate onSubmit={submit} onInput={() => setError("")} className="rs-col">
        <Switch
          className="rs-swrow"
          label="The father is the custodian"
          hint={father}
          checked={dad}
          onCheckedChange={(on) => {
            setDad(on)
            setRel(null)
            setPicked(null)
            setSame(null)
            setError("")
            if (on) window.setTimeout(() => phoneRef.current?.focus(), 330)
          }}
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
                window.setTimeout(() => waRef.current?.focus(), 320)
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
        </GuidedReveal>
        <GuidedReveal open={needName}>
          <PersonNameBoxes id={`${id}-cn`} aria-labelledby={`${id}-title`} labels={NAME_LABELS} value={name} onChange={setName} />
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

export function OnFileQuestion({ id, first, onFileName, admissionNumber, father, saved, onPick }: { id: string; first: string; onFileName: string; admissionNumber: string; father: string; saved?: boolean; onPick: (yes: boolean) => void }) {
  const savedValue = saved === undefined ? undefined : saved ? "yes" : "no"
  const [value, setValue] = useState<string | null>(savedValue ?? null)
  const pick = (v: string) => onPick(v === "yes")
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
  const errId = `${id}-error`
  const inputId = useId()

  // Continue checks the code itself, so pressing it straight after typing waits for the answer.
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (checking) return
    const v = formatCode(code)
    if (v.length < 3) return setError("Type the code, or choose No code.")
    setChecking(true)
    let lookup: ReferralLookup
    try {
      lookup = await lookUpReferralCode(v)
    } catch {
      lookup = { status: "unavailable" }
    }
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
            setNone(true)
            window.setTimeout(() => onDone("none"), PICK_MS)
          }}
        />
        <ContinuePill variant="ghost" onClick={() => setTyping(true)}>
          They have a code
        </ContinuePill>
        <GuidedReveal open={typing}>
          <CodeBox
            id={inputId}
            placeholder="Discount code, e.g. ABC-123"
            aria-label="Discount code"
            value={code}
            invalid={!!error}
            aria-describedby={errId}
            onValueChange={(v) => {
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

export function SubmitQuestion({ who, failure, pending, onSubmit }: { who: string; failure: ReactNode; pending: boolean; onSubmit: () => void }) {
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
