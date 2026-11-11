"use client"

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"

import { ContinuePill, GuidedHead, GuidedStack, GuidedStep, Hint, QuestionTitle, revealStep, SummaryRow, type ProgressGroup } from "@/components/guided-form"
import { ButtonLink, ChoiceTiles, DefaultTile, Field, FieldError, GuidedReveal, GuidedTask, Note, TextLink, toast } from "@/components/kit"

// The guided form on a staff page (#321), played with the prototype's own
// registration questions and words (version 13, "Register students"),
// fixture answers only. It saves nothing.

const GROUPS = ["Students", "Custodians", "Finish"]
const CLASSES = ["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3", "FORM 4"]
const NAME_PARTS = ["First name", "Father’s name", "Last name", "Surname (if any)"]
const MOST = 8
const YES = "Yes, the father"
const NO = "No, someone else"
// The prototype waits this long after a tap, so the chosen tile shows before the question folds.
const PICK_MS = 240
const RESET_MS = 460
const FINISH_MS = 950

// `key` stays with a student when another is removed, so a half-typed answer stays with its student.
type Student = { key: number; parts?: string[]; name?: string; father?: string; cls?: string; board?: string }
type Custodian = { dad: boolean; phone: string; name: string; rel: string }
type Answers = { students: Student[]; more?: boolean; custodian?: Custodian; code?: string; submitted?: boolean }

type Head = { key: string; title: string; remove?: number }
type Step = { id: string; group: number; head: Head; label: string; done: boolean; silent?: boolean; summary: () => ReactNode; body: () => ReactNode }

let nextKey = 0
const newStudent = (): Student => ({ key: ++nextKey })
const fresh = (): Answers => ({ students: [newStudent()] })
const clean = (v: string) => v.trim().replace(/\s+/g, " ")
const first = (name?: string) => (name ?? "").trim().split(/\s+/)[0] || "the student"
const list = (a: string[]) => (a.length < 2 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`)
const digits = (v: string) => v.replace(/\D/g, "")
const count = (n: number) => `${n} ${n > 1 ? "students" : "student"}`

export function GuidedDemo() {
  const [answers, setAnswers] = useState<Answers>(fresh)
  const [edit, setEdit] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const [instant, setInstant] = useState(false)
  // After the first answer a new question takes focus and scrolls into view as it opens, not on page load.
  const [interacted, setInteracted] = useState(false)
  // Start over draws a fresh form, so a half-typed answer goes too.
  const [round, setRound] = useState(0)
  // Pending taps, the reset spin and the finish delay; cleared on unmount and on a restart.
  const [timers] = useState(() => new Set<number>())

  useEffect(() => () => timers.forEach((t) => window.clearTimeout(t)), [timers])
  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [instant])

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  function answer(id: string, change: (a: Answers) => Answers) {
    setInteracted(true)
    setAnswers(change)
    setEdit((e) => (e === id ? null : e))
  }
  const setStudent = (i: number, patch: Partial<Student>) => (a: Answers) => ({ ...a, students: a.students.map((s, k) => (k === i ? { ...s, ...patch } : s)) })

  function restart() {
    timers.forEach((t) => window.clearTimeout(t))
    timers.clear()
    setInstant(true)
    setRound((r) => r + 1)
    setAnswers(fresh())
    setEdit(null)
    setFinished(false)
  }

  // Once Register is pressed the answers are final; nothing changes them while the finished screen comes in.
  const locked = !!answers.submitted

  function removeStudent(i: number) {
    if (locked) return
    setInteracted(true)
    setInstant(true)
    // The custodian is asked again: the students it covers have changed.
    setAnswers((a) => ({ ...a, students: a.students.filter((_, k) => k !== i), custodian: undefined }))
    setEdit(null)
    toast("Student removed. Check the custodians again.")
  }

  const steps = buildSteps(answers, { answer, setStudent, setAnswers, setEdit, later, onSubmit: () => later(() => setFinished(true), FINISH_MS) })
  const firstOpen = steps.findIndex((s) => !s.done)
  const visible = steps.slice(0, firstOpen < 0 ? steps.length : firstOpen + 1).filter((s) => !s.silent)
  const editing = edit && visible.some((s) => s.id === edit && s.done) ? edit : null
  const openId = editing ?? (firstOpen >= 0 ? steps[firstOpen].id : null)
  const open = steps.find((s) => s.id === openId)
  const at = visible.findIndex((s) => s.id === openId)

  const groups: ProgressGroup[] = GROUPS.map((label, g) => {
    const own = steps.filter((s) => s.group === g && !s.silent)
    const now = own.findIndex((s) => s.id === openId && !s.done)
    return { label, steps: own.length, done: own.filter((s) => s.done).length, current: now }
  })
  const activeGroup = open ? open.group : GROUPS.length - 1
  const g = groups[activeGroup]

  function onOpened(li: HTMLLIElement) {
    // The first text field, unless it waits in a part that hasn't unfolded yet; else the question.
    const field = [...li.querySelectorAll<HTMLInputElement>('.gf-fold input:not([type="radio"])')].find((input) => !input.closest("[inert]"))
    const title = li.querySelector<HTMLElement>(".gf-fold h2")
    ;(field ?? title)?.focus({ preventScroll: true })
    revealStep(li)
  }

  const items: ReactNode[] = []
  let lastHead: string | null = null
  for (const s of visible) {
    if (s.head.key !== lastHead) {
      lastHead = s.head.key
      const remove = s.head.remove
      items.push(
        <GuidedHead
          key={`h:${s.head.key}`}
          aside={
            remove !== undefined && (
              <TextLink onClick={() => removeStudent(remove)} aria-label={`Remove ${s.head.title}`}>
                Remove
              </TextLink>
            )
          }
        >
          {s.head.title}
        </GuidedHead>,
      )
    }
    items.push(
      <GuidedStep
        key={s.id}
        state={s.id === openId ? "open" : "folded"}
        onOpened={onOpened}
        openOnMount={interacted}
        summary={
          s.done && (
            <SummaryRow
              label={s.label}
              value={s.summary()}
              action={
                <TextLink onClick={() => !locked && setEdit(s.id)} aria-label={`Change ${s.label}${s.group === 0 && s.id !== "more" ? `, ${s.head.title}` : ""}`}>
                  Change
                </TextLink>
              }
            />
          )
        }
      >
        {s.body()}
      </GuidedStep>,
    )
  }

  const n = answers.students.length
  return (
    <GuidedTask
      progress={{
        groups,
        activeGroup,
        canBack: at > 0,
        onBack: () => at > 0 && setEdit(visible[at - 1].id),
        canReset: at === 0 && openId === steps[0].id,
        onReset: () => later(restart, RESET_MS),
        labels: { back: "Back", reset: "Start over" },
        status: g ? `${g.label}: ${g.done} of ${g.steps}` : "",
      }}
      finished={
        finished
          ? {
              title: `${count(n)} registered`,
              hint: "Give the family these Admission Numbers.",
              results: answers.students.map((s, i) => ({ label: s.name, value: `DMSN-${90013 + i}` })),
              children: (
                <>
                  <ButtonLink href="/staff/applicants" size="wide" chevron>
                    Open Applicants
                  </ButtonLink>
                  <ContinuePill variant="ghost" onClick={restart}>
                    Register another family
                  </ContinuePill>
                </>
              ),
            }
          : null
      }
    >
      <GuidedStack key={round} instant={instant}>
        {items}
      </GuidedStack>
    </GuidedTask>
  )
}

type Tools = {
  answer: (id: string, change: (a: Answers) => Answers) => void
  setStudent: (i: number, patch: Partial<Student>) => (a: Answers) => Answers
  setAnswers: (change: (a: Answers) => Answers) => void
  setEdit: (id: string | null) => void
  later: (fn: () => void, ms: number) => void
  onSubmit: () => void
}

function buildSteps(a: Answers, t: Tools): Step[] {
  const steps: Step[] = []
  const n = a.students.length
  let head: Head = { key: "s0", title: "Student 1" }
  a.students.forEach((s, i) => {
    const f = first(s.name)
    head = { key: `s${i}`, title: s.name ?? `Student ${i + 1}`, remove: n > 1 ? i : undefined }
    steps.push({
      id: `s${i}.name`,
      group: 0,
      head,
      label: "Full name",
      done: s.name !== undefined,
      summary: () => (
        <>
          {s.name}
          <small className="kp-fa">Father: {s.father}</small>
        </>
      ),
      body: () => <NameQuestion key={`name:${s.key}:${s.name ?? ""}`} index={i} student={s} onDone={(parts) => t.answer(`s${i}.name`, nameAnswer(i, parts, t))} />,
    })
    steps.push(pickStep(`s${i}.cls`, head, "Class", s.cls, `Which class is ${f} joining?`, CLASSES, "four", (v) => t.answer(`s${i}.cls`, t.setStudent(i, { cls: v })), t))
    steps.push(pickStep(`s${i}.board`, head, "Day or boarding", s.board, `Will ${f} be a day or a boarding student?`, ["Day", "Boarding"], "two", (v) => t.answer(`s${i}.board`, t.setStudent(i, { board: v })), t))
  })

  steps.push({
    id: "more",
    group: 0,
    head,
    label: "Students on this form",
    done: a.more === false,
    summary: () => count(n),
    body: () => (
      <>
        <QuestionTitle>{n < MOST ? "Is there another student?" : "That is 8 students, the most one form takes"}</QuestionTitle>
        <Hint>
          {n} of {MOST} on this form.
        </Hint>
        {n < MOST && (
          <ContinuePill
            variant="ghost"
            icon="plus"
            onClick={() => {
              // The custodian is asked again, for the new student too.
              t.answer("more", (x) => ({ ...x, more: undefined, custodian: undefined, students: [...x.students, newStudent()] }))
            }}
          >
            Yes, add a student
          </ContinuePill>
        )}
        <ContinuePill onClick={() => t.answer("more", (x) => ({ ...x, more: false }))}>No, go to custodians</ContinuePill>
      </>
    ),
  })

  const names = list(a.students.map((s) => first(s.name)))
  const father = a.students[0]?.father ?? ""
  steps.push({
    id: "cust",
    group: 1,
    head: { key: "g1", title: "Custodians" },
    label: `Custodian of ${names}`,
    done: !!a.custodian,
    summary: () => a.custodian && `${a.custodian.name} · ${a.custodian.rel} · ${a.custodian.phone}`,
    body: () => <CustodianQuestion key={`cust:${names}:${father}`} names={names} father={father} saved={a.custodian} onDone={(c) => t.answer("cust", (x) => ({ ...x, custodian: c }))} />,
  })

  const finish: Head = { key: "g2", title: "Finish" }
  steps.push({
    id: "code",
    group: 2,
    head: finish,
    label: "Discount code",
    done: a.code !== undefined,
    summary: () => (a.code === "none" ? "No code" : `${a.code} · family told who sees the progress`),
    body: () => <CodeQuestion key={`code:${a.code ?? ""}`} saved={a.code} onDone={(code) => t.answer("code", (x) => ({ ...x, code }))} later={t.later} />,
  })
  steps.push({
    id: "submit",
    group: 2,
    head: finish,
    label: "",
    done: !!a.submitted,
    silent: !!a.submitted,
    summary: () => "",
    body: () => (
      <>
        <QuestionTitle>Register {count(n)}?</QuestionTitle>
        <Hint>Each student gets an Admission Number, and today’s visit is recorded.</Hint>
        <ContinuePill
          onClick={() => {
            t.answer("submit", (x) => ({ ...x, submitted: true }))
            t.onSubmit()
          }}
        >
          Register {count(n)}
        </ContinuePill>
      </>
    ),
  })
  return steps
}

/** The names after the first are the father's full name. A changed father asks the custodian again. */
function nameAnswer(i: number, parts: string[], t: Tools) {
  return (a: Answers): Answers => {
    const father = parts.slice(1).filter(Boolean).join(" ")
    const old = a.students[i]?.father
    const next = t.setStudent(i, { parts, name: parts.filter(Boolean).join(" "), father })(a)
    return old !== undefined && old !== father ? { ...next, custodian: undefined } : next
  }
}

/** A question answered by one tap: the tile shows as chosen, then the question folds. Pressing the chosen tile again after Change answers too. */
function pickStep(id: string, head: Head, label: string, value: string | undefined, title: string, options: string[], layout: "two" | "four", onPick: (v: string) => void, t: Tools): Step {
  return {
    id,
    group: 0,
    head,
    label,
    done: value !== undefined,
    summary: () => value,
    body: () => <PickQuestion key={`${id}:${value ?? ""}`} name={id} title={title} options={options} layout={layout} saved={value} onPick={(v) => t.later(() => onPick(v), PICK_MS)} />,
  }
}

function PickQuestion({ name, title, options, layout, saved, onPick }: { name: string; title: string; options: string[]; layout: "two" | "four"; saved?: string; onPick: (v: string) => void }) {
  const [value, setValue] = useState<string | null>(saved ?? null)
  const again = (e: MouseEvent) => {
    const input = e.target as HTMLInputElement
    if (input.type === "radio" && input.checked && input.value === saved) onPick(input.value)
  }
  return (
    <div onClick={again}>
      <ChoiceTiles
        name={name}
        layout={layout}
        big
        legend={<QuestionTitle>{title}</QuestionTitle>}
        options={options.map((o) => ({ value: o, label: o }))}
        value={value}
        onChange={(v) => {
          setValue(v)
          onPick(v)
        }}
      />
    </div>
  )
}

function NameQuestion({ index, student, onDone }: { index: number; student: Student; onDone: (parts: string[]) => void }) {
  const [parts, setParts] = useState<string[]>(() => student.parts ?? ["", "", "", ""])
  const [error, setError] = useState("")
  const [bad, setBad] = useState(-1)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const father = parts.slice(1).map(clean).filter(Boolean).join(" ")
  const errId = `kgd-${index}-name-error`

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = parts.map(clean)
    const missing = v.findIndex((p, k) => k < 3 && !p)
    if (missing >= 0) {
      setError("Type at least three names: the student’s own name, the father’s name and the last name.")
      setBad(missing)
      refs.current[missing]?.focus()
      return
    }
    onDone(v)
  }

  return (
    <>
      <QuestionTitle>{index ? "What is the next student’s full name?" : "What is the student’s full name?"}</QuestionTitle>
      <Hint>Start with the student’s own name. The names after it are taken as the father’s name.</Hint>
      <form noValidate onSubmit={submit}>
        <div className="kp-names">
          {NAME_PARTS.map((ph, k) => (
            <Field
              key={ph}
              ref={(el) => {
                refs.current[k] = el
              }}
              placeholder={ph}
              aria-label={ph}
              autoComplete="off"
              autoCapitalize="words"
              value={parts[k]}
              invalid={bad === k}
              aria-describedby={bad === k ? errId : undefined}
              onChange={(e) => {
                const value = e.target.value
                setParts((p) => p.map((x, j) => (j === k ? value : x)))
                setError("")
                setBad(-1)
              }}
            />
          ))}
        </div>
        <p className="gf-hint kp-fa-live" aria-live="polite">
          {father && `Father: ${father}`}
        </p>
        <FieldError id={errId} message={error} />
        <ContinuePill type="submit">Continue</ContinuePill>
      </form>
    </>
  )
}

function CustodianQuestion({ names, father, saved, onDone }: { names: string; father: string; saved?: Custodian; onDone: (c: Custodian) => void }) {
  const [dad, setDad] = useState<boolean | undefined>(saved?.dad)
  const [phone, setPhone] = useState(saved?.phone ?? "")
  const [name, setName] = useState(saved && !saved.dad ? saved.name : "")
  const [rel, setRel] = useState<string | null>(saved && !saved.dad ? saved.rel : null)
  const [error, setError] = useState("")
  const phoneOk = digits(phone).length >= 10
  const nameOk = clean(name).split(" ").length > 1
  const ready = dad === true ? phoneOk : dad === false && nameOk && !!rel

  function submit(e: FormEvent) {
    e.preventDefault()
    if (dad === undefined) return setError("Choose who the custodian is.")
    if (!phoneOk) return setError("Type the mobile number in full, for example 0712 345 678.")
    if (!dad && (!nameOk || !rel)) return setError("Add the custodian’s name and their relationship.")
    onDone(dad ? { dad, phone: clean(phone), name: father, rel: "Father" } : { dad, phone: clean(phone), name: clean(name), rel: rel! })
  }

  return (
    <>
      <QuestionTitle>Is the father the main custodian of {names}?</QuestionTitle>
      <Hint>{father}. The custodian is responsible for school matters, and for paying the school fees.</Hint>
      <form noValidate onSubmit={submit} onInput={() => setError("")}>
        <ChoiceTiles
          name="kgd-dad"
          layout="two"
          legend={<span className="sr-only">Is the father the main custodian?</span>}
          options={[YES, NO].map((o) => ({ value: o, label: o }))}
          value={dad === undefined ? null : dad ? YES : NO}
          onChange={(v) => {
            setDad(v === YES)
            setRel(null)
            setError("")
          }}
        />
        <GuidedReveal open={dad !== undefined}>
          <Field icon="phone" inputMode="tel" placeholder="Mobile number, e.g. 0712 345 678" aria-label="Custodian’s mobile number" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </GuidedReveal>
        <GuidedReveal open={dad === false && phoneOk}>
          <Field placeholder="Custodian’s full name" aria-label="Custodian’s full name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </GuidedReveal>
        <GuidedReveal open={dad === false && phoneOk && nameOk}>
          <Hint>Relationship to {names}</Hint>
          <ChoiceTiles
            name="kgd-rel"
            layout="three"
            legend={<span className="sr-only">Relationship to {names}</span>}
            options={["Mother", "Guardian", "Other"].map((o) => ({ value: o, label: o }))}
            value={rel}
            onChange={setRel}
          />
        </GuidedReveal>
        <FieldError id="kgd-cust-error" message={error} />
        <GuidedReveal open={ready}>
          <ContinuePill type="submit">Continue</ContinuePill>
        </GuidedReveal>
      </form>
    </>
  )
}

function CodeQuestion({ saved, onDone, later }: { saved?: string; onDone: (code: string) => void; later: (fn: () => void, ms: number) => void }) {
  const has = saved !== undefined && saved !== "none"
  const [none, setNone] = useState(saved === "none")
  const [typing, setTyping] = useState(has)
  const [code, setCode] = useState(has ? saved : "")
  const [error, setError] = useState("")

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = clean(code).toUpperCase()
    if (v.length < 3) return setError("Type the code, or choose No code.")
    onDone(v)
  }

  return (
    <>
      <QuestionTitle>Does the family have a Discount code?</QuestionTitle>
      <Hint>It takes an amount off the interview fee. It never changes school fees.</Hint>
      <form noValidate onSubmit={submit}>
        <DefaultTile
          label="NO CODE"
          tagline="Nothing to enter"
          pressed={none}
          onClick={() => {
            setNone(true)
            later(() => onDone("none"), PICK_MS)
          }}
        />
        <ContinuePill variant="ghost" onClick={() => setTyping(true)}>
          They have a code
        </ContinuePill>
        <GuidedReveal open={typing}>
          <Field
            placeholder="Discount code"
            aria-label="Discount code"
            autoComplete="off"
            value={code}
            invalid={!!error}
            aria-describedby="kgd-code-error"
            onChange={(e) => {
              setCode(e.target.value)
              setError("")
            }}
          />
          <Note>Tell the family: the person who gave them this code will see this student’s admission progress.</Note>
          <FieldError id="kgd-code-error" message={error} />
          <ContinuePill type="submit">Continue</ContinuePill>
        </GuidedReveal>
      </form>
    </>
  )
}
