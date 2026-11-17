"use client"

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

import { GuidedHead, GuidedStack, GuidedStep, Hint, QuestionTitle, revealStep, SummaryRow, ContinuePill, type ProgressGroup } from "@/components/guided-form"
import { Button, ButtonLink, GuidedTask, Note, Sheet, TextLink, toast } from "@/components/kit"
import type { RegistrationQuestion } from "@/lib/services/leads"

import { readOnFileSibling, registerFamily, type RegisterFamilyOutcome } from "./actions"
import { clearDraft, readDraft, saveDraft } from "./draft"
import {
  count,
  fatherName,
  feeOf,
  feePreview,
  feeSignature,
  firstOf,
  freshAnswers,
  households,
  isEmpty,
  linkedOnFile,
  linking,
  list,
  mentionsSiblings,
  MOST_STUDENTS,
  NO_SCHOOL_ASKED,
  onFileAnswer,
  onFileAsk,
  onFileLinks,
  onFileMatch,
  onFileQuestion,
  rootOf,
  settled,
  withCustodian,
  withName,
  withOnFile,
  withoutStudent,
  withSibling,
  broughtChoices,
  otherFather,
  payload,
  people,
  relationshipLabel,
  sameFatherEarlier,
  studentName,
  tzs,
  yearOf,
  type Answers,
  type Custodian,
  type FeeTable,
  type OnFileAsk,
  type OnFileFee,
  type OnFileLink,
  type SiblingAnswer,
  type Student,
} from "./model"
import {
  BoardQuestion,
  BroughtQuestion,
  ClassQuestion,
  CodeQuestion,
  CustodianQuestion,
  FeesQuestion,
  FeesUnread,
  MismatchSheet,
  NameQuestion,
  OnFileQuestion,
  PICK_MS,
  SchoolQuestion,
  SiblingQuestion,
  SubmitQuestion,
  TypoSheet,
  type NamePair,
} from "./questions"

// Register students (#308): the staff form for a family with no Admission
// Number, prototype v38. Up to 8 students first, then their custodians, then
// the finish: the Discount code, the fees and one save for everyone.

const GROUPS = ["Students", "Custodians", "Finish"]
const RESET_MS = 460
// One sheet closes before the next opens.
const SHEET_MS = 380
const FINISH_MS = 950
const KEPT = "Your answers are kept on this computer, so you don’t need to type them again."

type Head = { key: string; title: string; remove?: number }
type Step = { id: string; group: number; head: Head; label: string; done: boolean; silent?: boolean; summary: () => ReactNode; body: () => ReactNode }

type Finished = Extract<RegisterFamilyOutcome, { status: "created" }> & { names: string[]; unknownSchools: number }

/** A question the save asked about a student joining a child on file's group, as one of the two sheets shows it. */
type SaveQuestion = { key: number; root: number; leadId: string; tier: "close" | "different"; pair: NamePair }

/**
 * A sheet about a child on file's group, not about a student on the form.
 * `pick`: staff answered Yes to the child, and the answers wait here until the household needs no more.
 * `save`: the save asked, so each answer is kept as it is given and the next question opens.
 */
type FileSheet =
  | { from: "pick"; ask: OnFileAsk; read: OnFileFee; links: Record<number, OnFileLink> }
  | { from: "save"; root: number; leadId: string; rest: SaveQuestion[] }

/** An open sheet: about a sibling on the form (`of`, compared with the student `counted`), or about a group on file. */
type SheetAsk = { key: number; pair: NamePair; clear: () => void } & ({ of: number; counted: number | null; seen: number[]; file?: undefined } | { file: FileSheet })

const readFees = (m: Record<string, OnFileFee | "failed">) => Object.fromEntries(Object.entries(m).filter((e): e is [string, OnFileFee] => e[1] !== "failed"))

export type RegisterStudentsProps = {
  staffId: string
  today: string
  years: readonly number[]
  defaultYear: number
  fees: FeeTable
  // leads.edit: the database links siblings and takes a Discount code only for it.
  canLink: boolean
  canEnterCode: boolean
  // leads.view: the custodian's number is checked against families on file.
  canCheck: boolean
}

let lastKey = 0
const nextKey = (a?: Answers) => {
  lastKey = Math.max(lastKey, ...(a?.students.map((s) => s.key) ?? [0])) + 1
  return lastKey
}

const noSubscribe = () => () => {}

/** The form reads this tab's draft as it starts, so it draws in the browser only. */
export function RegisterStudents(props: RegisterStudentsProps) {
  const browser = useSyncExternalStore(noSubscribe, () => true, () => false)
  return browser ? <RegisterForm {...props} /> : null
}

function startingAnswers(staffId: string): Answers {
  const draft = readDraft(staffId)
  if (draft && !isEmpty(draft)) {
    nextKey(draft)
    // Only answers that still hold: the rest are asked again.
    return settled(draft)
  }
  return freshAnswers(nextKey())
}

function RegisterForm({ staffId, today, years, defaultYear, fees, canLink, canEnterCode, canCheck }: RegisterStudentsProps) {
  const [answers, setAnswers] = useState<Answers>(() => startingAnswers(staffId))
  const [edit, setEdit] = useState<string | null>(null)
  const [finished, setFinished] = useState<Finished | null>(null)
  const [instant, setInstant] = useState(false)
  const [interacted, setInteracted] = useState(false)
  const [round, setRound] = useState(0)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ReactNode>(null)
  // The fee and group of each child on file staff linked, or "failed" when it could not be read.
  const [onFileFees, setOnFileFees] = useState<Record<string, OnFileFee | "failed">>({})
  const asked = useRef(new Set<string>())
  const [startOver, setStartOver] = useState(false)
  const [typo, setTypo] = useState<SheetAsk | null>(null)
  const [mismatch, setMismatch] = useState<(SheetAsk & { close: boolean }) | null>(null)
  // What the form holds now, for an answer that arrives after a read or a sheet.
  const latest = useRef({ answers, onFileFees })
  const reading = useRef(new Set<string>())
  // The latest pick on each student's on-file question: a read that comes back after another pick is ignored.
  const picks = useRef(new Map<number, { leadId: string; yes: boolean }>())
  const [sheetRound, setSheetRound] = useState(0)
  const [timers] = useState(() => new Set<number>())

  useEffect(() => {
    if (!finished) saveDraft(staffId, answers)
  }, [answers, staffId, finished])
  useEffect(() => () => timers.forEach((t) => window.clearTimeout(t)), [timers])
  useEffect(() => {
    latest.current = { answers, onFileFees }
  }, [answers, onFileFees])
  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [instant])
  // Children on file staff linked: their fee and group, for the fee step. A read that fails is
  // kept as failed, so the fee step can't be accepted on a guess; Try again reads it again.
  function readFee(leadId: string) {
    asked.current.add(leadId)
    readOnFileSibling(leadId)
      .catch(() => null)
      .then((read) => setOnFileFees((m) => ({ ...m, [leadId]: read?.status === "read" ? read.fee : "failed" })))
  }
  useEffect(() => {
    for (const q of linkedOnFile(answers)) if (!asked.current.has(q.leadId)) readFee(q.leadId)
  }, [answers])
  function retryFees() {
    const failed = linkedOnFile(answers).filter((q) => onFileFees[q.leadId] === "failed")
    setOnFileFees((m) => Object.fromEntries(Object.entries(m).filter(([id]) => !failed.some((q) => q.leadId === id))))
    for (const q of failed) readFee(q.leadId)
  }

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  const locked = pending || !!finished
  function answer(id: string, change: (a: Answers) => Answers) {
    if (locked) return
    setInteracted(true)
    setFailure(null)
    setAnswers(change)
    setEdit((e) => (e === id ? null : e))
  }
  const setStudent = (key: number, patch: Partial<Student>) => (a: Answers): Answers => ({
    ...a,
    feesChecked: undefined,
    students: a.students.map((s) => (s.key === key ? { ...s, ...patch } : s)),
  })

  function restart() {
    timers.forEach((t) => window.clearTimeout(t))
    timers.clear()
    clearDraft(staffId)
    setInstant(true)
    setRound((r) => r + 1)
    setAnswers(freshAnswers(nextKey()))
    setEdit(null)
    setFinished(null)
    setFailure(null)
    setOnFileFees({})
    asked.current.clear()
    reading.current.clear()
    picks.current.clear()
    setSheetRound((r) => r + 1)
  }

  function removeStudent(key: number) {
    if (locked) return
    setInteracted(true)
    setInstant(true)
    // Siblings of the removed student lose that answer; the custodians are asked again.
    setAnswers((a) => withoutStudent(a, key))
    setEdit(null)
    toast("Student removed. Check the custodians again.")
  }

  // A father's name that changes asks again every answer built on it.
  const setName = (key: number, name: NonNullable<Student["name"]>) => answer(`s${key}.name`, (a) => withName(a, key, name))

  // A new sibling answer changes the households: every answer it no longer supports is asked again.
  const setSibling = (key: number, sibling: SiblingAnswer) => answer(`s${key}.sib`, (a) => withSibling(a, key, sibling))

  function pickSibling(key: number, value: string, clear: () => void) {
    const index = answers.students.findIndex((s) => s.key === key)
    // The same-father students this question named: the answer holds only while they are the ones.
    const seen = sameFatherEarlier(answers.students, index)
    if (value === "none") return later(() => setSibling(key, { kind: "none", seen }), PICK_MS)
    const of = Number(value)
    const mine = answers.students[index]
    // What the database will compare when it links this student: the name the sibling's group
    // counts by at that moment, never that of a student waiting on a Sibling request.
    const compared = linking(answers.students).compared.get(key)?.get(of)
    const theirs = answers.students.find((s) => s.key === compared?.with)
    if (!mine || !compared || !theirs) return
    const pair: NamePair = {
      mine: { first: firstOf(studentName(mine.name)), father: fatherName(mine.name) },
      theirs: { first: firstOf(studentName(theirs.name)), father: compared.theirs },
    }
    if (compared.tier === "same") {
      later(() => {
        setSibling(key, { kind: "match", of, seen })
        toast("Same father’s name. The 10% sibling discount applies.")
      }, PICK_MS)
    } else {
      // Each question opens a fresh sheet: no choice or note from the last one.
      setSheetRound((r) => r + 1)
      if (compared.tier === "close") setTypo({ key, of, counted: compared.with, pair, seen, clear })
      else setMismatch({ key, of, counted: compared.with, pair, close: false, seen, clear })
    }
  }

  // A sheet about a group on file. Each question opens a fresh one.
  function openFileSheet(key: number, pair: NamePair, tier: "close" | "different", file: FileSheet, clear: () => void) {
    setSheetRound((r) => r + 1)
    if (tier === "close") setTypo({ key, pair, clear, file })
    else setMismatch({ key, pair, close: false, clear, file })
  }

  /**
   * Yes to a child on file. Its group may count by another father's name (the child itself may wait on a
   * Sibling request there), and the save compares each student of the household with that name. So the
   * group is read first, and every question the save would ask is asked here, on the sheets a sibling on
   * the form gets. The Yes is kept once none is left.
   */
  function pickOnFile(ask: OnFileAsk, yes: boolean, clear: () => void) {
    const id = `f${ask.student}`
    if (locked) return
    picks.current.set(ask.student, { leadId: ask.leadId, yes })
    if (!yes)
      return later(() => {
        if (picks.current.get(ask.student)?.yes === false) answer(id, (x) => withOnFile(x, ask.student, { leadId: ask.leadId, yes: false }))
      }, PICK_MS)
    if (reading.current.has(ask.leadId)) return
    reading.current.add(ask.leadId)
    asked.current.add(ask.leadId)
    readOnFileSibling(ask.leadId)
      .catch(() => null)
      .then((r) => {
        reading.current.delete(ask.leadId)
        const read = r?.status === "read" ? r.fee : null
        setOnFileFees((m) => ({ ...m, [ask.leadId]: read ?? "failed" }))
        // Staff chose No, another child, or started over while the group was read: that choice stands.
        const last = picks.current.get(ask.student)
        if (!last?.yes || last.leadId !== ask.leadId) return
        // Unread, the Yes is kept as it was given: the fee step stops until the read works, and this question opens again if a sheet is needed.
        if (read) nextOnFile({ from: "pick", ask, read, links: {} }, clear)
        else answer(id, (x) => withOnFile(x, ask.student, { leadId: ask.leadId, yes: true }))
      })
  }

  function nextOnFile(flow: Extract<FileSheet, { from: "pick" }>, clear: () => void) {
    const { ask, read, links } = flow
    const now = latest.current
    const given = { leadId: ask.leadId, yes: true, ...(Object.keys(links).length > 0 ? { links } : {}) }
    const q = onFileQuestion(withOnFile(now.answers, ask.student, given), { ...readFees(now.onFileFees), [ask.leadId]: read }, ask.student)
    if (!q) {
      answer(`f${ask.student}`, (x) => withOnFile(x, ask.student, given))
      if (Object.keys(links).length === 0) toast("Same father’s name. The 10% sibling discount applies.")
      return
    }
    const mine = now.answers.students.find((s) => s.key === q.student)
    const theirs = q.compared.onFile ?? studentName(now.answers.students.find((s) => s.key === q.compared.with)?.name)
    const pair: NamePair = {
      mine: { first: firstOf(studentName(mine?.name)), father: fatherName(mine?.name) },
      theirs: { first: firstOf(theirs), father: q.compared.theirs },
    }
    openFileSheet(q.student, pair, q.compared.tier === "close" ? "close" : "different", flow, clear)
  }

  /** A sheet about a group on file answered. `none` is "They are not siblings". */
  function fileAnswered(sheet: SheetAsk & { file: FileSheet }, link: OnFileLink | "none") {
    const file = sheet.file
    const root = file.from === "pick" ? file.ask.student : file.root
    const leadId = file.from === "pick" ? file.ask.leadId : file.leadId
    if (link === "none") {
      // Said of the household's first student, it answers the question about the child on file. Said of a
      // sibling linked to that student, it answers nothing here, and the question stays open.
      if (sheet.key === root) answer(`f${root}`, (x) => withOnFile(x, root, { leadId, yes: false }))
      else sheet.clear()
      return
    }
    if (file.from === "pick") {
      const next = { ...file, links: { ...file.links, [sheet.key]: link } }
      later(() => nextOnFile(next, sheet.clear), SHEET_MS)
      return
    }
    answer(`f${root}`, (x) => withOnFile(x, root, { leadId, yes: true, links: { ...x.onFile[root]?.links, [sheet.key]: { ...link, fromSave: true } } }))
    if (file.rest.length > 0) later(() => openSaveQuestions(file.rest), SHEET_MS)
  }

  function openSaveQuestions([q, ...rest]: SaveQuestion[]) {
    const who = firstOf(studentName(latest.current.answers.students.find((s) => s.key === q.key)?.name))
    // Closed without an answer, the save would only ask again: say what is still open.
    const unanswered = () => setFailure(needsChecking([who]))
    openFileSheet(q.key, q.pair, q.tier, { from: "save", root: q.root, leadId: q.leadId, rest }, unanswered)
  }

  const needsChecking = (who: string[]) => (
    <>
      <b>Nothing was saved.</b> {`The sibling answers for ${list([...new Set(who)])} need checking. Change them, then press the button again.`} {KEPT}
    </>
  )

  const steps = buildSteps(answers)
  const firstOpen = steps.findIndex((s) => !s.done)
  const visible = steps.slice(0, firstOpen < 0 ? steps.length : firstOpen + 1).filter((s) => !s.silent)
  const editing = edit && visible.some((s) => s.id === edit && s.done) ? edit : null
  const openId = editing ?? (firstOpen >= 0 ? steps[firstOpen].id : null)
  const open = steps.find((s) => s.id === openId)
  const at = visible.findIndex((s) => s.id === openId)

  function buildSteps(a: Answers): Step[] {
    const out: Step[] = []
    const n = a.students.length
    const link = linking(a.students)
    const father = (key: number) => link.fathers.get(key) ?? ""
    const read = readFees(onFileFees)
    // The household whose Yes to a child on file still needs a sheet answer, now that the child's group is read.
    const fileAsk = linking(a.students, onFileLinks(a, read)).ask
    const fileOpen = fileAsk ? rootOf(a.students, fileAsk.student) : null
    let head: Head = { key: "s", title: "Student 1" }
    a.students.forEach((s, i) => {
      const sid = `s${s.key}`
      const full = studentName(s.name)
      const f = firstOf(full)
      head = { key: sid, title: full || `Student ${i + 1}`, remove: n > 1 ? s.key : undefined }
      out.push({
        id: `${sid}.name`,
        group: 0,
        head,
        label: "Full name",
        done: !!s.name,
        summary: () => (
          <>
            {full}
            <small className="rs-fa">Father: {father(s.key)}</small>
          </>
        ),
        body: () => <NameQuestion id={`rs-${sid}`} next={i > 0} saved={s.name} onDone={(name) => setName(s.key, name)} />,
      })
      const year = yearOf(a.students, i, defaultYear)
      out.push({
        id: `${sid}.cls`,
        group: 0,
        head,
        label: "Class",
        done: !!s.className,
        summary: () => `${s.className} · ${year}`,
        body: () => (
          <ClassQuestion
            id={`rs-${sid}-cls`}
            first={f}
            saved={s.className}
            year={year}
            years={years}
            onYear={(y) => answer(`${sid}.year`, setStudent(s.key, { year: y }))}
            onPick={(cls) => later(() => answer(`${sid}.cls`, setStudent(s.key, { className: cls, school: NO_SCHOOL_ASKED.includes(cls) ? undefined : s.school })), PICK_MS)}
          />
        ),
      })
      out.push({
        id: `${sid}.board`,
        group: 0,
        head,
        label: "Day or boarding",
        done: !!s.board,
        summary: () => s.board,
        body: () => <BoardQuestion id={`rs-${sid}`} first={f} saved={s.board} onPick={(v) => later(() => answer(`${sid}.board`, setStudent(s.key, { board: v })), PICK_MS)} />,
      })
      if (s.className && !NO_SCHOOL_ASKED.includes(s.className)) {
        out.push({
          id: `${sid}.school`,
          group: 0,
          head,
          label: "Previous school",
          done: !!s.school,
          summary: () =>
            !s.school ? "" : "notKnown" in s.school ? "Not known yet · add it later on the student’s record" : `${s.school.name} · ${s.school.type === "private" ? "Private" : "Public"} · ${s.school.region}`,
          body: () => (
            <SchoolQuestion
              id={`rs-${sid}-school`}
              first={f}
              saved={s.school}
              onDone={(school) => answer(`${sid}.school`, setStudent(s.key, { school }))}
              onNotKnown={() => {
                answer(`${sid}.school`, setStudent(s.key, { school: { notKnown: true } }))
                toast("Saved as Not known yet. Add it later on the student’s record.")
              }}
            />
          ),
        })
      }
      if (i > 0 && canLink) {
        const same = new Set(sameFatherEarlier(a.students, i))
        const sib = s.sibling
        out.push({
          id: `${sid}.sib`,
          group: 0,
          head,
          label: "Sibling",
          done: !!sib,
          summary: () => {
            if (!sib) return ""
            if (sib.kind === "none") return "Not a sibling"
            const of = firstOf(studentName(a.students.find((x) => x.key === sib.of)?.name))
            const why = { match: "same father’s name, 10% applies", typo: "typing mistake fixed, same father, 10% applies", request: "different fathers’ names, discount requested" }[sib.kind]
            return `Sibling of ${of} · ${why}`
          },
          body: () => (
            <SiblingQuestion
              id={`rs-${sid}`}
              first={f}
              father={fatherName(s.name)}
              saved={sib ? (sib.kind === "none" ? "none" : String(sib.of)) : undefined}
              choices={[...a.students.slice(0, i).filter((x) => same.has(x.key)), ...a.students.slice(0, i).filter((x) => !same.has(x.key))].map((x) => ({
                key: x.key,
                name: studentName(x.name),
                // Their father's name when this student is linked, before any later correction.
                father: link.compared.get(s.key)?.get(x.key)?.father ?? fatherName(x.name),
                same: same.has(x.key),
              }))}
              onPick={(v, clear) => pickSibling(s.key, v, clear)}
            />
          ),
        })
      }
    })

    out.push({
      id: "more",
      group: 0,
      head,
      label: "Students on this form",
      done: !!a.more,
      summary: () => count(n),
      body: () => (
        <>
          <QuestionTitle>{n < MOST_STUDENTS ? "Is there another student?" : "That is 8 students, the most one form takes"}</QuestionTitle>
          <Hint>{`${n} of ${MOST_STUDENTS} on this form.`}</Hint>
          {n < MOST_STUDENTS && (
            <ContinuePill
              variant="ghost"
              icon="plus"
              onClick={() => answer("more", (x) => ({ ...x, more: undefined, custodians: {}, brought: undefined, feesChecked: undefined, students: [...x.students, { key: nextKey(x) }] }))}
            >
              Yes, add a student
            </ContinuePill>
          )}
          <ContinuePill onClick={() => answer("more", (x) => ({ ...x, more: true }))}>No, go to custodians</ContinuePill>
        </>
      ),
    })

    const hh = households(a.students)
    const custodiansHead: Head = { key: "g1", title: "Custodians" }
    const finish: Head = { key: "g2", title: "Finish" }
    const firstCustodian = hh[0] ? a.custodians[hh[0].root] : undefined
    const { people: adults } = people(a)
    const firstName = (c: Custodian | undefined) =>
      !c ? "" : c.kind === "father" ? (c.contact?.fullName ?? father(hh[0].root)) : c.kind === "known" ? c.contact.fullName : c.kind === "new" ? [c.name.firstName, c.name.middleName, c.name.lastName].join(" ") : ""
    hh.forEach((h, k) => {
      const id = `c${h.root}`
      const names = list(h.members.map((m) => firstOf(studentName(a.students.find((s) => s.key === m)?.name))))
      const c = a.custodians[h.root]
      out.push({
        id,
        group: 1,
        head: custodiansHead,
        label: `Custodian of ${names}`,
        done: !!c,
        summary: () => {
          if (!c) return ""
          if (c.kind === "same") return `${firstName(firstCustodian)} · ${relationshipLabel(c.relationship, c.description)}`
          const who = c.kind === "father" ? (c.contact?.fullName ?? father(h.root)) : c.kind === "known" ? c.contact.fullName : firstName(c)
          const rel = c.kind === "father" ? "Father" : relationshipLabel(c.relationship, c.description)
          const file = (c.kind === "father" && c.contact) || c.kind === "known" ? " · already on file" : ""
          return `${who} · ${rel} · ${c.phone}${c.whatsapp ? ` · WhatsApp ${c.whatsapp}` : ""}${file}`
        },
        body: () => (
          <CustodianQuestion
            id={`rs-${id}`}
            names={names}
            father={father(h.root)}
            first={k > 0 && firstCustodian && firstCustodian.kind !== "same" ? { name: firstName(firstCustodian) } : null}
            saved={c}
            canCheck={canCheck}
            otherFather={(() => {
              const k = otherFather(a, h)
              return k === null ? null : firstOf(studentName(a.students.find((s) => s.key === k)?.name))
            })()}
            onDone={(custodian) => answer(id, (x) => withCustodian(x, h.root, custodian))}
          />
        ),
      })
      const ask = canLink && c ? (a.onFileAsks.find((q) => q.student === h.root && !q.fromSave) ?? onFileMatch(a, h.root)) : null
      if (ask) out.push(onFileStep(a, ask, custodiansHead, fileOpen))
    })

    out.push({
      id: "brought",
      group: 1,
      head: custodiansHead,
      label: "Brought the students today",
      done: !!a.brought,
      summary: () => {
        const b = a.brought
        if (!b) return ""
        return b.who === "else" ? `${b.name}${b.relationship ? ` · ${b.relationship}` : ""}` : (adults[b.person]?.name ?? "")
      },
      body: () => (
        <BroughtQuestion
          id="rs-brought"
          who={n > 1 ? "the students" : firstOf(studentName(a.students[0]?.name))}
          people={broughtChoices(adults)}
          saved={a.brought}
          onDone={(brought) => answer("brought", (x) => ({ ...x, brought }))}
        />
      ),
    })

    if (canEnterCode) {
      out.push({
        id: "code",
        group: 2,
        head: finish,
        label: "Discount code",
        done: a.code !== undefined,
        summary: () => (a.code === "none" ? "No code" : `${a.code} · family told who sees the progress`),
        body: () => <CodeQuestion id="rs-code" saved={a.code} onDone={(code) => answer("code", (x) => ({ ...x, code }))} />,
      })
    }

    for (const ask of a.onFileAsks.filter((q) => q.fromSave)) out.push(onFileStep(a, ask, finish, fileOpen))

    // The fee step waits for every linked child on file, and its answer holds only for the preview shown.
    // A fee that could not be read stops it: the preview would be a guess.
    const reads = linkedOnFile(a).map((q) => onFileFees[q.leadId])
    const unread = reads.includes("failed")
    const loading = reads.some((r) => r === undefined)
    const preview = feePreview(a, fees, defaultYear, read)
    if (preview) {
      const shown = feeSignature(preview)
      out.push({
        id: "fees",
        group: 2,
        head: finish,
        label: mentionsSiblings(a, preview) ? "Fees and sibling discount" : "Fees",
        done: !loading && !unread && a.feesChecked === shown,
        summary: () => `${tzs(preview.total)} this year`,
        body: () =>
          unread ? (
            <FeesUnread onRetry={retryFees} />
          ) : loading ? (
            <Hint>Checking the fees…</Hint>
          ) : (
            <FeesQuestion answers={a} preview={preview} onOk={() => answer("fees", (x) => ({ ...x, feesChecked: shown }))} />
          ),
      })
    }

    out.push({
      id: "submit",
      group: 2,
      head: finish,
      label: "",
      done: false,
      summary: () => "",
      body: () => <SubmitQuestion who={count(n)} failure={failure} pending={pending} onSubmit={submit} />,
    })
    return out
  }

  // `open`: the household whose Yes still needs a sheet answer.
  function onFileStep(a: Answers, ask: OnFileAsk, head: Head, open: number | null): Step {
    const s = a.students.find((x) => x.key === ask.student)
    const id = `f${ask.student}`
    const saved = onFileAnswer(a, ask.student)
    const how = a.onFile[ask.student]?.links?.[ask.student]?.kind
    const why = how === "typo" ? "typing mistake fixed, same father, 10% applies" : how === "request" ? "different fathers’ names, discount requested" : "same father’s name"
    return {
      id,
      group: head.key === "g1" ? 1 : 2,
      head,
      label: `Sibling on file of ${firstOf(studentName(s?.name))}`,
      done: saved !== undefined && !(saved && open === ask.student),
      summary: () => (saved ? `Sibling of ${ask.name} · ${why}` : "Not a sibling"),
      body: () => (
        <OnFileQuestion
          id={`rs-${id}`}
          first={firstOf(studentName(s?.name))}
          onFileName={ask.name}
          admissionNumber={ask.admissionNumber}
          father={ask.father}
          saved={saved}
          onPick={(yes, clear) => pickOnFile(ask, yes, clear)}
        />
      ),
    }
  }

  function nameOf(student?: number) {
    const s = student ? answers.students[student - 1] : undefined
    return s ? studentName(s.name) : ""
  }

  function failureFor(outcome: Exclude<RegisterFamilyOutcome, { status: "created" | "questions" }>): ReactNode {
    const nothing = <b>Nothing was saved.</b>
    switch (outcome.status) {
      case "duplicate": {
        const lines = outcome.duplicates.map((d) => {
          const name = nameOf(d.student)
          return `${name} is already registered, with Admission Number ${d.admissionNumber}. Remove ${firstOf(name)} from this form, or change the name if it is a different student.`
        })
        return (
          <>
            {nothing} {lines.join(" ")} {KEPT}
          </>
        )
      }
      case "closed":
        return (
          <>
            {nothing} The sibling on file chosen for {nameOf(outcome.student) || "a student"} is Declined or closed, so they can’t be linked. Answer Not a sibling, then press the button again. {KEPT}
          </>
        )
      case "forbidden":
        return (
          <>
            {nothing} Your role can’t register students, or can’t link siblings. Ask the Admissions Manager. {KEPT}
          </>
        )
      case "refused": {
        const who = outcome.student ? nameOf(outcome.student) : ""
        const what =
          outcome.reason === "father_names_differ"
            ? `${who}’s father is another man, so the father can’t be the custodian of them all. Change the custodian`
            : (outcome.field === "phone" || outcome.field === "whatsapp") && outcome.reason === "repeated_on_form"
              ? "Two different custodians on this form have the same phone number. Change one of them"
              : outcome.field === "phone" || outcome.field === "whatsapp"
            ? "One of the custodians’ phone numbers can’t be read. Check it"
            : outcome.field === "student_name" && outcome.reason === "repeated_on_form"
              ? `${who} is on this form twice. Remove one`
              : who
                ? `Something in ${who}’s answers can’t be saved. Check them`
                : "Something on the form can’t be saved. Check the answers"
        return (
          <>
            {nothing} {what}, then press the button again. {KEPT}
          </>
        )
      }
      default:
        return (
          <>
            {nothing} Check your connection and press the button again. {KEPT}
          </>
        )
    }
  }

  /**
   * The save's questions the form can ask. A child on file with the same father's name becomes a step.
   * A name or a Sibling request about a household staff linked to a child on file opens the sheet a
   * sibling on the form gets. Null when a question is neither.
   */
  function askFromSave(questions: RegistrationQuestion[]): { asks: OnFileAsk[]; sheets: SaveQuestion[] } | null {
    const asks: OnFileAsk[] = []
    const sheets: SaveQuestion[] = []
    const students = answers.students
    const read = readFees(onFileFees)
    const link = linking(students, onFileLinks(answers, read))
    for (const q of questions) {
      const s = students[q.student - 1]
      if (!s) return null
      if (q.kind === "same-father") {
        if (!("otherLeadId" in q)) return null
        const child = Object.values(answers.custodians)
          .flatMap((c) => (c.kind === "father" || c.kind === "known" ? (c.contact?.children ?? []) : []))
          .find((x) => x.id === q.otherLeadId)
        asks.push({ student: s.key, leadId: q.otherLeadId, name: child?.studentName ?? q.otherAdmissionNumber, admissionNumber: q.otherAdmissionNumber, father: fatherName(s.name), fromSave: true })
        continue
      }
      const root = rootOf(students, s.key)
      const file = onFileAnswer(answers, root) === true ? onFileAsk(answers, root) : null
      if (!file || (q.kind !== "name" && q.kind !== "request-note")) return null
      const group = read[file.leadId]
      const first = firstOf(studentName(s.name))
      if (q.kind === "name") {
        // The database names the member it compared: a student here, or a member of the child on file's group.
        const theirs = "siblingStudent" in q ? studentName(students[q.siblingStudent - 1]?.name) : (group?.counted.find((m) => m.leadId === q.siblingLeadId)?.name ?? file.name)
        sheets.push({ key: s.key, root, leadId: file.leadId, tier: "close", pair: { mine: { first, father: q.fatherFullName }, theirs: { first: firstOf(theirs), father: q.siblingFatherFullName } } })
        continue
      }
      // A request's question names nobody: the sheet shows the name the form's own reading of the group compares.
      const c = s.key === root ? link.onFile.get(s.key) : s.sibling && s.sibling.kind !== "none" ? link.compared.get(s.key)?.get(s.sibling.of) : undefined
      const theirs =
        c && c.tier !== "same"
          ? { first: firstOf(c.onFile ?? studentName(students.find((x) => x.key === c.with)?.name)), father: c.theirs }
          : { first: firstOf(file.name), father: group?.father ?? file.father }
      sheets.push({ key: s.key, root, leadId: file.leadId, tier: "different", pair: { mine: { first, father: fatherName(s.name) }, theirs } })
    }
    return { asks, sheets }
  }

  function submit() {
    if (locked) return
    setPending(true)
    setFailure(null)
    const { people: adults, students } = payload(answers, defaultYear, readFees(onFileFees))
    const code = answers.code && answers.code !== "none" ? answers.code : null
    registerFamily({ visitDate: today, people: adults, students, code })
      .then((outcome) => {
        setPending(false)
        if (outcome.status === "created") {
          clearDraft(staffId)
          const names = answers.students.map((s) => studentName(s.name))
          const unknownSchools = answers.students.filter((s) => s.school && "notKnown" in s.school && s.className && !NO_SCHOOL_ASKED.includes(s.className)).length
          later(() => setFinished({ ...outcome, names, unknownSchools }), FINISH_MS)
          return
        }
        if (outcome.status === "questions") {
          const shown = outcome.questions.length > 0 ? askFromSave(outcome.questions) : null
          if (shown) {
            const { asks, sheets } = shown
            if (asks.length > 0) setAnswers((a) => ({ ...a, onFileAsks: [...a.onFileAsks.filter((q) => !asks.some((x) => x.student === q.student)), ...asks], feesChecked: undefined }))
            if (sheets.length > 0) openSaveQuestions(sheets)
            return
          }
          setFailure(needsChecking(outcome.questions.map((q) => firstOf(nameOf(q.student)))))
          return
        }
        setFailure(failureFor(outcome))
      })
      .catch(() => {
        setPending(false)
        setFailure(failureFor({ status: "unavailable" }))
      })
  }

  function onOpened(li: HTMLLIElement) {
    const field = [...li.querySelectorAll<HTMLInputElement>('.gf-fold input:not([type="radio"]):not([type="checkbox"])')].find((input) => !input.closest("[inert]"))
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
        key={`${s.id}:${round}`}
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

  const groups: ProgressGroup[] = GROUPS.map((label, g) => {
    const own = steps.filter((s) => s.group === g && !s.silent && s.id !== "submit")
    const now = own.findIndex((s) => s.id === openId && !s.done)
    return { label, steps: own.length + (g === 2 ? 1 : 0), done: own.filter((s) => s.done).length + (g === 2 && finished ? 1 : 0), current: now >= 0 ? now : g === 2 && openId === "submit" ? own.length : undefined }
  })
  const activeGroup = open ? open.group : GROUPS.length - 1
  const g = groups[activeGroup]
  const n = answers.students.length
  const lowerFee = (() => {
    // Known for two students on the form only: a member on file's fee is not read.
    if (!mismatch || mismatch.file || mismatch.counted === null) return null
    const fee = (key: number) => {
      const i = answers.students.findIndex((s) => s.key === key)
      const s = answers.students[i]
      return s?.className && s.board ? feeOf(fees, yearOf(answers.students, i, defaultYear), s.className, s.board) : null
    }
    const a = fee(mismatch.key)
    const b = fee(mismatch.counted)
    if (a === null || b === null) return null
    return a <= b ? mismatch.pair.mine.first : mismatch.pair.theirs.first
  })()

  return (
    <>
      <GuidedTask
        progress={{
          groups,
          activeGroup,
          canBack: at > 0 && !locked,
          onBack: () => at > 0 && setEdit(visible[at - 1].id),
          canReset: at <= 0 && openId === steps[0].id,
          onReset: () => {
            if (isEmpty(answers)) toast("Nothing to clear yet. The form is empty.")
            else setStartOver(true)
          },
          labels: { back: "Back", reset: "Start over" },
          status: g ? `${g.label}: ${g.done} of ${g.steps}` : "",
        }}
        finished={
          finished
            ? {
                title: `${count(finished.students.length)} registered`,
                hint: "Give the family these Admission Numbers.",
                results: finished.students.map((s) => ({ label: finished.names[s.student - 1], value: s.admissionNumber })),
                children: (
                  <>
                    {finished.ten > 0 && <Note tone="good" icon="check">{`The 10% sibling discount is on ${count(finished.ten)}.`}</Note>}
                    {finished.requests > 0 && (
                      <Note tone="wait" icon="alert">{`${finished.requests} discount ${finished.requests > 1 ? "requests wait" : "request waits"} for the Admissions Manager. Remind the family to bring proof.`}</Note>
                    )}
                    {finished.unknownSchools > 0 && (
                      <Note tone="wait">{`${finished.unknownSchools} previous ${finished.unknownSchools > 1 ? "schools are" : "school is"} saved as Not known yet. Add ${finished.unknownSchools > 1 ? "them" : "it"} later on the student’s record in Applicants.`}</Note>
                    )}
                    {finished.codeMissed > 0 && (
                      <Note tone="wait" icon="alert">{`The Discount code wasn’t saved on ${count(finished.codeMissed)}. Add it on the student’s record in Applicants.`}</Note>
                    )}
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

      <Sheet
        open={startOver}
        onOpenChange={setStartOver}
        placement="centre"
        title="Start over?"
        hint="Everything typed on this form will be cleared."
        closeLabel="Close"
        foot={
          <>
            <Button
              variant="bad"
              size="wide"
              onClick={() => {
                setStartOver(false)
                later(() => {
                  restart()
                  toast("The form has started over.")
                }, RESET_MS)
              }}
            >
              Yes, clear the form
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setStartOver(false)}>
              No, keep my answers
            </Button>
          </>
        }
      >
        <Note tone="bad" icon="alert">
          This can’t be undone. You start again from the first question.
        </Note>
      </Sheet>

      <TypoSheet
        key={`typo:${sheetRound}`}
        open={!!typo}
        pair={typo?.pair ?? null}
        onClose={() => {
          typo?.clear()
          setTypo(null)
        }}
        onAnswer={(v) => {
          const t = typo
          if (!t) return
          setTypo(null)
          if (v === "different") {
            later(() => {
              setSheetRound((r) => r + 1)
              setMismatch({ ...t, close: true })
            }, SHEET_MS)
            return
          }
          const spelling = v === "mine" ? t.pair.mine.father : t.pair.theirs.father
          if (t.file) fileAnswered(t, { kind: "typo", spelling, against: t.pair.theirs.father })
          else setSibling(t.key, { kind: "typo", of: t.of, spelling, against: t.pair.theirs.father, seen: t.seen })
          toast("Saved as one name. They are siblings, and the 10% sibling discount applies.")
        }}
      />
      <MismatchSheet
        key={`mismatch:${sheetRound}`}
        open={!!mismatch}
        pair={mismatch?.pair ?? null}
        lowerFee={lowerFee}
        onClose={() => {
          mismatch?.clear()
          setMismatch(null)
        }}
        onRequest={(note) => {
          const m = mismatch
          if (!m) return
          setMismatch(null)
          const request = { kind: "request" as const, note: note.trim(), requestId: crypto.randomUUID(), close: m.close, against: m.pair.theirs.father }
          if (m.file) fileAnswered(m, request)
          else setSibling(m.key, { ...request, of: m.of, seen: m.seen })
          toast("Request sent to the Admissions Manager. Reason: fathers’ names don’t match.")
        }}
        onNotSiblings={() => {
          const m = mismatch
          if (!m) return
          setMismatch(null)
          if (m.file) fileAnswered(m, "none")
          else setSibling(m.key, { kind: "none", seen: m.seen })
        }}
      />
      <span className="sr-only" aria-live="polite">
        {pending ? `Registering ${count(n)}…` : ""}
      </span>
    </>
  )
}
