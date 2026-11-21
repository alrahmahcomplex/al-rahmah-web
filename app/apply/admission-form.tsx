"use client"

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { BrandTopBar } from "@/components/brand"
import { buzz, GuidedStack, ProgressBar, prefersReducedMotion, revealStep, useKeepFocusInView } from "@/components/guided-form"
import type { TurnstileWidgetHandle } from "@/components/turnstile-widget"
import { usePageLanguage } from "@/components/page-language"
import { admissionYears, childNameKey, MAX_CHILDREN, type FieldProblem, type FormField, type NamePart } from "@/lib/admission-form"
import type { Language } from "@/lib/language"
import { formatCount, shownApplicationCount } from "@/lib/live-apply"
import { discountCodeCookie, initialDiscountCode, normalizeDiscountCode, rememberedDiscountCode, STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { FORM_NOTICE_VERSION } from "@/lib/referral-notice"
import { tanzaniaToday } from "@/lib/school-calendar"

import { checkDiscountCode, submitAdmissionForm } from "./actions"
import { Confirmation } from "./confirmation"
import { COPY } from "./copy"
import { clearDraft, emptyChild, EMPTY_PARENT, isEmptyDraft, readDraft, writeDraft, type ChildDraft, type Custodian, type ParentDraft } from "./draft"
import {
  defaultYear as defaultYearFor,
  fatherIsCustodian,
  firstOpenable,
  furthest,
  keyToParam,
  order,
  paramToKey,
  parseKey,
  restoreDone,
  skipped,
  stepForProblem,
  stepProblems,
  STUDENT_KINDS,
  STUDENT_PARAM,
  studentKey,
  studentName,
  wireChild,
  wireParent,
  yearOf,
  type StepKey,
  type StudentKind,
} from "./flow"
import { useLiveApply } from "./live"
import type { AdmissionCalendar, AdmissionFormState, DiscountCodeCheck } from "./outcome"
import { boxOf, questionItems, stepId } from "./questions"
import { ClassSheet, OfferSheet, StartOverSheet } from "./sheets"

// The Admission form, one question at a time (concept C). Answered questions
// fold into a line with a "Badilisha …" link; Continue on a reopened question
// folds it again and returns to the first unanswered one. The order lives in
// ./flow.ts, the drawing in ./questions.tsx.
//
// Every entry lives in this component's state, so switching language (which
// changes the words in place, components/page-language.tsx) never loses one, and a draft in
// sessionStorage (./draft.ts) brings them back after a reload, with the
// questions already answered.
//
// Each question reached by moving forward gets its own history entry
// (`?q=class-1`, keeping `ref`), so the phone's Back and Forward move between
// questions instead of leaving the form. A question whose earlier questions
// aren't answered opens the first one that isn't.

type Shown = FieldProblem & { server: boolean }
type Notice = "check-pending" | "rate-limited" | "check-failed" | "unavailable" | null
type FormState = { parent: ParentDraft; children: ChildDraft[]; discountCode: string; done: ReadonlySet<StepKey>; open: StepKey }
type Sheet = { kind: "class"; card: number } | { kind: "offer" } | { kind: "start-over" } | null
type Outcome = { fullName: string; admissionNumber: string }

// How long Continue on the Discount code question waits for the code check.
const CODE_WAIT_MS = 6000

// How long The father, picked as the custodian, shows before the form moves on (prototype v54).
const FATHER_PAUSE_MS = 450

// How far below the top of the screen a box the caret moves to must sit, so
// the sticky bar doesn't cover it: the bar alone, and the bar with the section
// chip above it from the second question on.
const BAR_INSET = 84
const BAR_INSET_CHIP_UP = 112

const STUDENT_BOXES = ["firstName", "fatherFirst", "fatherMiddle", "fatherLast"] as const
const PERSON_BOXES = ["firstName", "middleName", "lastName"] as const

// Marks a history entry this form pushed.
const PUSHED = "admissionFormQ"

// A random key per form, kept until a confirmation shows, so sending the same
// form twice creates nothing new. Falls back to getRandomValues where
// randomUUID is missing (a page served over plain http).
function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// The current URL naming this question, every other parameter kept. The
// first question has no `q`. `step` belonged to the earlier three-step form.
function urlFor(key: StepKey, children: readonly ChildDraft[]): string {
  const url = new URL(window.location.href)
  const param = key === order(children)[0] ? null : keyToParam(key, children)
  if (param) url.searchParams.set("q", param)
  else url.searchParams.delete("q")
  url.searchParams.delete("step")
  return `${url.pathname}${url.search}${url.hash}`
}

// The question the URL names, or the first. An entry naming a student since
// removed (`board-2` with one student left) opens the same question for the
// last remaining student, the question before it on the form.
function urlKey(children: readonly ChildDraft[]): StepKey {
  const param = new URLSearchParams(window.location.search).get("q")
  const key = paramToKey(param, children)
  if (key) return key
  const removed = param ? STUDENT_PARAM.exec(param) : null
  const last = children[children.length - 1]
  return removed && last ? studentKey(removed[1] as StudentKind, last.card) : order(children)[0]
}

// The name box a problem should take focus in: the part it names, else the
// first empty box, else the first.
function nameBox(base: string, part: NamePart | undefined, boxes: readonly string[], values: object | undefined): string {
  const held = values as Record<string, unknown> | undefined
  const box = part ? boxOf(part) : (boxes.find((key) => !String(held?.[key] ?? "").trim()) ?? boxes[0])
  return `#${base}-${box}`
}

// The custodian's parts The father takes from the first student's father.
const FATHER_PART: Partial<Record<NamePart, NamePart>> = {
  contact_first_name: "father_first",
  contact_middle_name: "father_middle",
  contact_last_name: "father_last",
}

// A refusal as the page shows it. With The father picked, the custodian's
// names are the first student's father's, so a refused custodian name opens
// that student's name question on the father's box, the one to fix.
function refusalShown(result: { field: FormField; child: number | null; part?: NamePart }, parent: ParentDraft): Shown {
  const fatherPart = result.part ? FATHER_PART[result.part] : undefined
  if (result.field === "contact_name" && fatherIsCustodian(parent)) {
    return { field: "student_name", child: 0, ...(fatherPart ? { part: fatherPart } : {}), server: true }
  }
  return { field: result.field, child: result.child, ...(result.part ? { part: result.part } : {}), server: true }
}

// Where focus goes for a problem.
function problemSelector({ field, child, part }: FieldProblem, children: readonly ChildDraft[], parent: ParentDraft): string {
  const card = child === null ? null : (children[child]?.card ?? null)
  switch (field) {
    case "student_name":
      return nameBox(`student-name-${card}`, part, STUDENT_BOXES, child === null ? undefined : children[child])
    case "duplicate_child":
      return `#student-name-${card}-firstName`
    case "class_name":
      return `#${stepId(studentKey("class", card ?? 0))} .gf-pop`
    case "enrollment_year":
      return `input[name="year-${card}"]`
    case "gender":
      return `input[name="gender-${card}"]`
    case "day_or_boarding":
      return `input[name="board-${card}"]`
    case "contact_name":
      return parent.custodian === "other" ? nameBox("parent-name", part, PERSON_BOXES, parent) : 'input[name="custodian"]'
    case "relationship":
      return 'input[name="relationship"]'
    case "relationship_description":
      return "#relationship-description"
    case "phone":
      return "#phone"
    case "whatsapp":
      return "#whatsapp"
    case "discount_code":
      return "#discount-code"
    default:
      return "[data-form-problem]"
  }
}

function focusIn(root: ParentNode, selector: string): boolean {
  const target = root.querySelector<HTMLElement>(`${selector}:checked`) ?? root.querySelector<HTMLElement>(selector)
  target?.focus({ preventScroll: true })
  return Boolean(target)
}

const PROBLEM_FIELDS: Record<string, readonly FormField[]> = {
  firstName: ["student_name", "duplicate_child"],
  fatherFirst: ["student_name", "duplicate_child"],
  fatherMiddle: ["student_name", "duplicate_child"],
  fatherLast: ["student_name", "duplicate_child"],
  // The choice changes the student's name, so it can end a repeat.
  lastNameFrom: ["duplicate_child"],
  gender: ["gender"],
  className: ["class_name"],
  enrollmentYear: ["enrollment_year"],
  dayOrBoarding: ["day_or_boarding"],
}

// The years a parent may pick and the coming intake, from the browser's clock
// in Tanzania time.
function browserCalendar(): AdmissionCalendar {
  const years = admissionYears()
  return { years, defaultYear: defaultYearFor(years, tanzaniaToday()) }
}

// The Discount code the browser remembers from the latest Referral link.
function rememberedCode(): string | undefined {
  return rememberedDiscountCode(document.cookie)
}

export function AdmissionFormSteps({
  language: copyLanguage,
  years: builtYears,
  defaultYear: builtDefaultYear,
  officePhone,
  showLanguagePrompt = false,
}: {
  // The language of the copy the page was built for.
  language: Language
  // The years when the page was built. The form works them out again as it
  // opens, and takes the server's from a refusal.
  years: [number, number]
  // The coming intake, which a student's year starts from.
  defaultYear: number
  officePhone: string
  // No language cookie yet: the first-visit language card shows.
  showLanguagePrompt?: boolean
}) {
  const language = usePageLanguage(copyLanguage)
  const copy = COPY[language]
  const [{ years, defaultYear }, setCalendar] = useState<AdmissionCalendar>({ years: builtYears, defaultYear: builtDefaultYear })
  // Where the Discount code field starts: the Referral link's code, else the
  // one remembered from an earlier link, else empty. Read from the address
  // and the cookie once the page is up: the server's copy is the same for
  // every visitor and holds no code.
  const [startingCode, setStartingCode] = useState("")
  // The Referral link's code, when the page opened from one: remembered for
  // 30 days from now, replacing any earlier one.
  const [rememberDiscountCode, setRememberDiscountCode] = useState<string | null>(null)
  const live = useLiveApply()
  const [form, setFormState] = useState<FormState>(() => ({
    parent: EMPTY_PARENT,
    children: [emptyChild(1)],
    discountCode: startingCode,
    done: new Set(),
    open: studentKey("name", 1),
  }))
  // The same state, read by handlers that run after a timeout or an await.
  const formRef = useRef(form)
  function setForm(next: FormState) {
    formRef.current = next
    setFormState(next)
  }
  const lastCard = useRef(1)
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey)
  const [problems, setProblems] = useState<Shown[]>([])
  const problemsRef = useRef(problems)
  useLayoutEffect(() => {
    problemsRef.current = problems
  })
  // Whether the stored draft has been read. Until then nothing is written,
  // so the empty first render never replaces a draft.
  const [restored, setRestored] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirmed, setConfirmed] = useState<{ outcomes: Outcome[]; saved: number } | null>(null)
  const [alreadySent, setAlreadySent] = useState<"all" | "some" | null>(null)
  const [sending, startSending] = useTransition()
  // Counts restarts, so an answer to a send from before a restart is ignored:
  // it must not clear the new form's draft or replace it with a confirmation.
  const round = useRef(0)
  const [answers, setAnswers] = useState<Record<string, DiscountCodeCheck>>({})
  const answersRef = useRef(answers)
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set())
  const inflight = useRef(new Map<string, Promise<DiscountCodeCheck>>())
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [yearOpen, setYearOpen] = useState<ReadonlySet<number>>(() => new Set())
  const [whatsappOn, setWhatsappOn] = useState(false)
  // After the parent's first tap a new question takes focus as it opens.
  const [interacted, setInteracted] = useState(false)
  const [instant, setInstant] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [announcement, setAnnouncement] = useState("")
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const doneHeading = useRef<HTMLHeadingElement>(null)
  const lastPointer = useRef(0)
  // The pause after The father is picked, before the form moves on.
  const switchTimer = useRef<number | undefined>(undefined)
  // The browser event that last picked a custodian button, so the click that
  // picked The father doesn't also count as a click on him again.
  const pickedBy = useRef<Event | undefined>(undefined)
  // The code nobody has that Continue has already stopped on once.
  const stoppedFor = useRef<string | null>(null)
  // The questions this page has history entries for, in history order, and
  // the entry the browser is on. A ref, not history.state: Next.js rewrites
  // the entry's state when a Server Action (the language switch) refreshes
  // the page.
  const trail = useRef<StepKey[]>([])
  const pos = useRef(0)
  // Whether the open question was reached through the browser's Back or
  // Forward, on its own history entry. Continue from there then adds the next
  // question's entry after it, instead of taking its place (round 2, #513).
  const viaHistory = useRef(false)
  // Sent back to an earlier question's own entry: the problems to show once
  // its popstate arrives.
  const arriving = useRef<{ key: StepKey; shown: Shown[] } | null>(null)

  useEffect(() => {
    if (!rememberDiscountCode) return
    document.cookie = discountCodeCookie(rememberDiscountCode, { secure: window.location.protocol === "https:" })
  }, [rememberDiscountCode])

  // Keeps the tab's title in the page's language after a switch.
  useEffect(() => {
    document.title = `${copy.title} · Al-Rahmah Complex`
  }, [copy.title])

  // Brings back the tab's draft and opens the question the URL names, or the
  // first one not answered. Runs once, after hydration: the page is the same
  // for every visitor, so the tab's storage, the address's `ref` and the
  // remembered code are read here, and the years are worked out again in
  // case the copy was built before 1 January or 1 April.
  useEffect(() => {
    const calendar = browserCalendar()
    const { years } = calendar
    const refs = new URLSearchParams(window.location.search).getAll("ref")
    const { code: startingCode, remember: rememberDiscountCode } = initialDiscountCode({
      ref: refs.length > 1 ? refs : refs[0],
      cookie: rememberedCode(),
    })
    const draft = readDraft(years)
    // The draft's code stands unless a different Referral link opened the
    // page: a reload keeps `ref` in the URL, so the same link again is the
    // same form, and the parent's edit to the code stays.
    const keepsCode = draft && (!rememberDiscountCode || draft.linkCode === rememberDiscountCode)
    const entries = {
      parent: draft?.parent ?? EMPTY_PARENT,
      children: draft?.children ?? [emptyChild(1)],
      discountCode: keepsCode ? draft.discountCode : startingCode,
    }
    const done = draft ? restoreDone(draft.done, entries, years) : new Set<StepKey>()
    const first = firstOpenable(entries, done, years)
    const asked = paramToKey(new URLSearchParams(window.location.search).get("q"), entries.children)
    // The relationship question is skipped while the father is the custodian.
    const want = asked && skipped(asked, entries.parent) ? "pname" : asked
    const keys = order(entries.children)
    const open = want && keys.indexOf(want) <= keys.indexOf(first) ? want : first
    if (draft) lastCard.current = draft.children.length
    trail.current = [open]
    pos.current = 0
    const url = urlFor(open, entries.children)
    // After this commit, once Next.js has patched history, so its router
    // learns the corrected URL too.
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      setTimeout(() => window.history.replaceState(null, "", url), 0)
    }
    /* eslint-disable react-hooks/set-state-in-effect -- reading the tab's storage after hydration */
    setCalendar(calendar)
    setStartingCode(startingCode)
    setRememberDiscountCode(rememberDiscountCode)
    setForm({ ...entries, done, open })
    setWhatsappOn(entries.parent.whatsapp !== "")
    setRestored(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    // Once, on mount: later changes are the form's own.
  }, [])

  // Keeps the draft in step with the entries, until a confirmation shows.
  useEffect(() => {
    if (!restored || confirmed) return
    const { parent, children, discountCode, done } = form
    const named = [...done].map((key) => keyToParam(key, children)).filter((param): param is string => param !== null)
    writeDraft({ parent, children, discountCode, linkCode: rememberDiscountCode ?? "", done: named })
  }, [restored, confirmed, form, rememberDiscountCode])

  // A code already in the field (from a link, or kept from before) is
  // checked as the Discount code question opens, and as the fee or send
  // question opens after a reload, so a restored code shows its fee.
  useEffect(() => {
    const atOrAfterCode = form.open === "code" || form.open === "fee" || form.open === "send"
    if (restored && atOrAfterCode && form.discountCode.trim()) void checkCode(form.discountCode, true)
    // Only when the question opens; edits are checked on blur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, form.open])

  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [instant])

  useEffect(() => {
    if (!confirmed) return
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })
    doneHeading.current?.focus({ preventScroll: true })
  }, [confirmed])

  // The phone's Back and Forward: open the question the entry names, as far
  // as the answers allow. A confirmation stays put.
  useEffect(() => {
    function onPopState() {
      if (confirmed) return
      const f = formRef.current
      const asked = urlKey(f.children)
      const want = skipped(asked, f.parent) ? "pname" : asked
      const keys = order(f.children)
      const first = firstOpenable(f, f.done, years)
      const target = keys.includes(want) && keys.indexOf(want) <= keys.indexOf(first) ? want : first
      const at = trail.current.indexOf(want)
      if (at >= 0) pos.current = at
      else {
        trail.current = [want]
        pos.current = 0
      }
      const arrival = arriving.current
      if (target !== want) {
        // Back to the allowed question's own entry when this page has one
        // before this, so the form's Back from there still steps through
        // history. Otherwise this entry becomes that question.
        const earlier = trail.current.indexOf(target)
        if (earlier >= 0 && earlier < pos.current) {
          window.history.go(earlier - pos.current)
          return
        }
        trail.current[pos.current] = target
        window.history.replaceState(null, "", urlFor(target, f.children))
      } else if (want !== asked) {
        // An entry for the relationship, skipped once The father was picked:
        // it shows the custodian question, so it names it.
        trail.current[pos.current] = want
        window.history.replaceState(null, "", urlFor(want, f.children))
      }
      viaHistory.current = true
      arriving.current = null
      setNotice(null)
      setInteracted(true)
      const shown = arrival?.key === target ? arrival.shown : []
      setProblems(shown)
      reveal(shown)
      if (target !== f.open) setForm({ ...f, open: target })
      else if (shown[0]) focusSoon(problemSelector(shown[0], f.children, f.parent))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [confirmed, years])

  function announce(text: string) {
    setAnnouncement("")
    window.setTimeout(() => setAnnouncement(text), 40)
  }

  function focusSoon(selector: string) {
    window.setTimeout(() => focusIn(document, selector), 30)
  }

  // Shows the fields a problem names: the year tiles, the WhatsApp field.
  function reveal(shown: readonly FieldProblem[]) {
    const f = formRef.current
    for (const problem of shown) {
      const card = problem.child === null ? null : f.children[problem.child]?.card
      if (problem.field === "enrollment_year" && card) setYearOpen((open) => new Set(open).add(card))
      if (problem.field === "whatsapp") setWhatsappOn(true)
    }
  }

  // Opens a question. `push` gives it a new history entry (moving forward);
  // `replace` swaps the current entry for it.
  function show(next: FormState, how: "push" | "replace") {
    viaHistory.current = false
    setForm(next)
    const url = urlFor(next.open, next.children)
    if (how === "push") {
      trail.current = [...trail.current.slice(0, pos.current + 1), next.open]
      pos.current = trail.current.length - 1
      window.history.pushState({ [PUSHED]: true }, "", url)
    } else {
      trail.current[pos.current] = next.open
      window.history.replaceState(null, "", url)
    }
  }

  // Sends the parent back to fix a question: to its own history entry when
  // this page has one earlier, so no later question's entry is left behind
  // it; else by swapping the current entry.
  function goTo(key: StepKey, shown: Shown[]) {
    const earlier = trail.current.indexOf(key)
    if (earlier >= 0 && earlier < pos.current) {
      arriving.current = { key, shown }
      window.history.go(earlier - pos.current)
      return
    }
    setProblems(shown)
    reveal(shown)
    const f = formRef.current
    if (f.open === key && shown[0]) focusSoon(problemSelector(shown[0], f.children, f.parent))
    show({ ...f, open: key }, "replace")
  }

  function showProblems(found: FieldProblem[]) {
    const shown = found.map((problem) => ({ ...problem, server: false }))
    setProblems(shown)
    reveal(shown)
    buzz()
    if (shown[0]) focusSoon(problemSelector(shown[0], formRef.current.children, formRef.current.parent))
  }

  // Clears the problems a change fixes, and any the server named.
  function clearProblems(fixed: (shown: Shown) => boolean) {
    setProblems((current) => (current.some((shown) => fixed(shown) || shown.server) ? current.filter((shown) => !fixed(shown) && !shown.server) : current))
  }

  // After a question opens: focus its problem, else its text field, else its
  // title; then bring it into view and read the question out.
  function onOpened(li: HTMLLIElement) {
    const f = formRef.current
    const first = problemsRef.current[0]
    const focused = first ? focusIn(li, problemSelector(first, f.children, f.parent)) : false
    if (!focused) {
      // The first empty text box that shows, else the first that shows.
      const boxes = [...li.querySelectorAll<HTMLInputElement>('.gf-fold input:not([type="radio"]):not([type="checkbox"]):not(#discount-code)')].filter(
        (input) => !input.closest("[inert]"),
      )
      const field = boxes.find((input) => !input.value) ?? boxes[0]
      const title = li.querySelector<HTMLElement>(".gf-fold h2")
      ;(field ?? title)?.focus({ preventScroll: true })
    }
    const title = li.querySelector<HTMLElement>(".gf-fold h2")
    if (title?.textContent) announce(title.textContent.trim())
    revealStep(li)
  }

  // Asks what a code means, unless it already has an answer or is being
  // asked about. A check that couldn't run is asked again next time. A value
  // that isn't a code is named under the field instead, without moving focus.
  async function checkCode(value: string, quiet = false): Promise<DiscountCodeCheck | null> {
    if (!value.trim()) return null
    const code = normalizeDiscountCode(value)
    if (!code) {
      if (!quiet) setProblems([{ field: "discount_code", child: null, server: false }])
      return null
    }
    const known = answersRef.current[code]
    if (known && "amount" in known) return known
    const running = inflight.current.get(code)
    if (running) return running
    const ask = (async () => {
      setChecking((current) => new Set(current).add(code))
      let result: DiscountCodeCheck
      try {
        result = await checkDiscountCode(code)
      } catch {
        result = { status: "unavailable" }
      }
      // Kept by code, so an answer that arrives after the parent typed on
      // still answers for that code if they go back to it.
      answersRef.current = { ...answersRef.current, [code]: result }
      setAnswers(answersRef.current)
      setChecking((current) => {
        const next = new Set(current)
        next.delete(code)
        return next
      })
      inflight.current.delete(code)
      return result
    })()
    inflight.current.set(code, ask)
    return ask
  }

  // Continue: fold the question and open the first one not answered.
  async function commit(key: StepKey) {
    const f = formRef.current
    if (f.open !== key) return
    setInteracted(true)
    setNotice(null)
    const { kind, card } = parseKey(key)
    const index = f.children.findIndex((child) => child.card === card)
    let children = f.children
    // A student's Day or Boarding starts as the student before's; a class
    // folds with the year it shows.
    if (kind === "board" && index > 0 && !children[index].dayOrBoarding) {
      children = children.map((child, i) => (i === index ? { ...child, dayOrBoarding: children[index - 1].dayOrBoarding } : child))
    }
    if (kind === "class" && children[index].enrollmentYear === null) {
      children = children.map((child, i) => (i === index ? { ...child, enrollmentYear: yearOf(children, index, defaultYear) } : child))
    }
    const found = stepProblems(key, { ...f, children }, years)
    if (found.length) {
      if (children !== f.children) setForm({ ...f, children })
      showProblems(found)
      return
    }
    const code = key === "code" ? normalizeDiscountCode(f.discountCode) : null
    if (code) {
      // Waits at most CODE_WAIT_MS: a stalled check never holds the parent
      // here, and the code is still saved unchecked with the application.
      const result = await Promise.race([
        checkCode(f.discountCode),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), CODE_WAIT_MS)),
      ])
      if (formRef.current.open !== key) return
      // Stop once on a code nobody has, so the parent reads the note.
      if (result?.status === "unknown" && stoppedFor.current !== code) {
        stoppedFor.current = code
        buzz()
        focusSoon("#discount-code")
        return
      }
    }
    const latest = formRef.current
    const done = new Set(latest.done).add(key)
    // With the father as custodian the relationship is Father: answered too.
    if (key === "pname" && fatherIsCustodian(latest.parent)) done.add("rel")
    const nextChildren = children === f.children ? latest.children : children
    setProblems([])
    setExpanded(new Set())
    // A reopened question folds into the entry it borrowed; one reached on its
    // own entry keeps it, and the next question gets a new one.
    show({ ...latest, children: nextChildren, done, open: furthest(nextChildren, done) }, latest.done.has(key) && !viaHistory.current ? "replace" : "push")
  }

  // A "Badilisha …" link: reopen an answered question, unless the open one
  // was answered before and now has a problem.
  function change(key: StepKey) {
    const f = formRef.current
    if (f.open !== key && f.done.has(f.open)) {
      const found = stepProblems(f.open, f, years)
      if (found.length) return showProblems(found)
    }
    setInteracted(true)
    setProblems([])
    setNotice(null)
    show({ ...f, open: key }, "replace")
  }

  // The form's Back: the question before, back through history when this
  // page moved forward from it, so the phone's Forward still works.
  function goBack() {
    const f = formRef.current
    const keys = order(f.children)
    let at = keys.indexOf(f.open)
    if (at <= 0) return
    while (at > 1 && skipped(keys[at - 1], f.parent)) at -= 1
    const target = keys[at - 1]
    setInteracted(true)
    setNotice(null)
    setProblems([])
    // This page pushed the entry: by moving forward here, or before a reload
    // (the entry's own marker survives one).
    const state: unknown = window.history.state
    const marked = Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[PUSHED])
    const pushedHere = pos.current > 0 && trail.current[pos.current - 1] === target && trail.current[pos.current] === f.open
    if (pushedHere || (marked && pos.current === 0 && trail.current[0] === f.open)) {
      window.history.back()
      return
    }
    show({ ...f, open: target }, "replace")
  }

  function updateChild(card: number, change: Partial<Omit<ChildDraft, "card">>, commitAfter = false) {
    const f = formRef.current
    const index = f.children.findIndex((child) => child.card === card)
    if (index < 0) return
    const children = f.children.map((child, i) => (i === index ? { ...child, ...change } : child))
    setForm({ ...f, children })
    const fields = new Set(Object.keys(change).flatMap((name) => PROBLEM_FIELDS[name] ?? []))
    clearProblems((shown) => shown.field === "children" || (fields.has(shown.field) && shown.child === index))
    if ("enrollmentYear" in change) setYearOpen((open) => new Set([...open].filter((c) => c !== card)))
    // A class tile answers at once.
    if (commitAfter && "className" in change) window.setTimeout(() => void commit(studentKey("class", card)), prefersReducedMotion() ? 0 : 200)
  }

  // A tap on Boy or Girl, on Day or Boarding, or on a relationship other than Other, answers
  // the question, as a tap on the one already picked does. Only a tap: the
  // arrow keys also move between radios.
  function tapChoice(key: StepKey, event: React.MouseEvent) {
    const target = event.target as HTMLElement
    if (!(target instanceof HTMLInputElement) || target.type !== "radio") return
    if (performance.now() - lastPointer.current > 900) return
    if (key === "rel" && target.value === "Other") return
    window.setTimeout(() => void commit(key), prefersReducedMotion() ? 0 : 200)
  }

  function updateParent(change: Partial<ParentDraft>) {
    const f = formRef.current
    setForm({ ...f, parent: { ...f.parent, ...change } })
    const fields = new Set<FormField>()
    if ("firstName" in change || "middleName" in change || "lastName" in change || "custodian" in change) fields.add("contact_name")
    if ("relationship" in change) fields.add("relationship").add("relationship_description")
    if ("relationshipDescription" in change) fields.add("relationship_description")
    if ("phone" in change) fields.add("phone")
    if ("whatsapp" in change) fields.add("whatsapp")
    clearProblems((shown) => fields.has(shown.field))
  }

  // Who the custodian is (#513). The father: the relationship is Father and the
  // form moves on to the phone after a moment. Someone else: the name boxes
  // open, and the relationship question comes back, empty if it was Father.
  function pickCustodian(who: Exclude<Custodian, "">) {
    window.clearTimeout(switchTimer.current)
    pickedBy.current = window.event
    const f = formRef.current
    const father = who === "father"
    const parent: ParentDraft = father
      ? { ...f.parent, custodian: who, relationship: "Father", relationshipDescription: "" }
      : { ...f.parent, custodian: who, relationship: f.parent.relationship === "Father" ? "" : f.parent.relationship }
    // The relationship question is answered (Father) or open again at once, not
    // when the pause ends: a Change link during the pause cancels the move on.
    const done = new Set(f.done)
    if (father) done.add("rel")
    else done.delete("rel")
    // A different custodian: the phone question opens again, so the number
    // typed for the one before is confirmed for this one (review, #513).
    if (f.parent.custodian !== "" && f.parent.custodian !== who) done.delete("phone")
    setForm({ ...f, parent, done })
    clearProblems((shown) => shown.field === "contact_name" || shown.field === "relationship" || shown.field === "relationship_description")
    if (father) switchTimer.current = window.setTimeout(() => void commit("pname"), prefersReducedMotion() ? 0 : FATHER_PAUSE_MS)
    else focusSoon(`#parent-name-${PERSON_BOXES.find((key) => !parent[key].trim()) ?? "firstName"}`)
  }

  // Enter, Space or a click on a custodian button that picks nothing new.
  // Space or a click on The father, already picked, answers the question, as
  // a tap on a picked tile does elsewhere: a tap and a screen reader's click
  // alike, since no Continue shows for him. Arrow keys always pick the other button, so
  // they never land here. Enter answers it as Continue would, so with nobody
  // picked it says to choose.
  function custodianAgain(event: React.MouseEvent | React.KeyboardEvent) {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.name !== "custodian") return
    if (event.type === "keydown") {
      const { key } = event as React.KeyboardEvent
      // Space on a checked radio makes no click in Chromium, so it is handled
      // here; prevented, it makes none in any browser either (round 2).
      const fatherAgain = key === " " && target.checked && target.value === "father" && fatherIsCustodian(formRef.current.parent)
      if (key !== "Enter" && !fatherAgain) return
      event.preventDefault()
      window.clearTimeout(switchTimer.current)
      void commit("pname")
      return
    }
    // The click that picked him is the pick's own; his pause moves on.
    if (target.value !== "father" || !fatherIsCustodian(formRef.current.parent) || event.nativeEvent === pickedBy.current) return
    window.clearTimeout(switchTimer.current)
    // Kept in the same timer, so picking Someone else straight after cancels it.
    switchTimer.current = window.setTimeout(() => void commit("pname"), prefersReducedMotion() ? 0 : 200)
  }

  // Start over, on the left on the first question and on the right after: a
  // toast on an empty form, the sheet otherwise.
  function askStartOver() {
    const f = formRef.current
    const empty = f.done.size === 0 && f.discountCode === startingCode && isEmptyDraft({ parent: f.parent, children: f.children, discountCode: "", linkCode: "", done: [] })
    if (empty) toast(copy.nothingToClear)
    else setSheet({ kind: "start-over" })
  }

  function addStudent() {
    const f = formRef.current
    if (f.children.length >= MAX_CHILDREN) return
    lastCard.current += 1
    const children = [...f.children, emptyChild(lastCard.current)]
    const done = new Set(f.done)
    done.delete("more")
    setInteracted(true)
    setProblems([])
    setExpanded(new Set())
    show({ ...f, children, done, open: furthest(children, done) }, "push")
  }

  function removeStudent(card: number) {
    const f = formRef.current
    if (f.children.length <= 1) return
    const children = f.children.filter((child) => child.card !== card)
    const done = new Set([...f.done].filter((key) => parseKey(key).card !== card))
    const keys = order(children)
    const open = !keys.includes(f.open) || f.open === "send" ? furthest(children, done) : f.open
    setProblems([])
    show({ ...f, children, done, open }, "replace")
    // The student's line folds away; put the reader back on the open question.
    window.setTimeout(() => {
      const li = document.getElementById(stepId(open))
      if (li) onOpened(li as HTMLLIElement)
    }, 340)
  }

  // Start over, "Fill in another form" and "Clear the whole form": an empty
  // form with the page's own code, and no draft.
  function restart(message: string | null) {
    round.current += 1
    window.clearTimeout(switchTimer.current)
    clearDraft()
    lastCard.current += 1
    const children = [emptyChild(lastCard.current)]
    const open = studentKey("name", lastCard.current)
    setForm({ parent: EMPTY_PARENT, children, discountCode: startingCode, done: new Set(), open })
    setSubmissionKey(newSubmissionKey())
    setConfirmed(null)
    setAlreadySent(null)
    setNotice(null)
    setProblems([])
    setExpanded(new Set())
    setYearOpen(new Set())
    setWhatsappOn(false)
    setSheet(null)
    setInstant(true)
    trail.current = [open]
    pos.current = 0
    window.history.replaceState(null, "", urlFor(open, children))
    window.scrollTo({ top: 0 })
    if (message) announce(message)
    focusSoon(`#student-name-${lastCard.current}-firstName`)
  }

  function onSend(formElement: HTMLFormElement) {
    // Also while going back to an earlier question, until its popstate arrives.
    if (sending || arriving.current) return
    const f = formRef.current
    for (const key of order(f.children)) {
      if (key === "send") break
      const found = stepProblems(key, f, years)
      if (found.length) return goTo(key, found.map((problem) => ({ ...problem, server: false })))
    }
    const data = new FormData(formElement)
    // Turnstile fills its token in a moment after the question opens;
    // sending before then would only be refused.
    if (!data.get("cf-turnstile-response")) {
      // A check that needs a click says so itself, next to Send.
      setNotice(turnstile.current?.reveal() ? null : "check-pending")
      return
    }
    const code = f.discountCode.trim()
    data.set(
      "form",
      JSON.stringify({
        submissionKey,
        parent: wireParent(f.parent, f.children),
        children: f.children.map(wireChild),
        discountCode: code || undefined,
        // The field has a value, so the code-holder notice is showing.
        noticeVersion: code ? FORM_NOTICE_VERSION : undefined,
      }),
    )
    setNotice(null)
    setProblems([])
    const saved = discountEach * f.children.length
    const sentIn = round.current
    startSending(async () => {
      let result: AdmissionFormState
      try {
        result = await submitAdmissionForm({ status: "idle" }, data)
      } catch {
        result = { status: "unavailable" }
      }
      if (round.current !== sentIn) return
      if (result.status === "confirmed" || result.status === "already-sent") {
        // The draft goes as soon as the confirmation shows, and the URL
        // drops its question, so a reload opens an empty form.
        clearDraft()
        const url = new URL(window.location.href)
        url.searchParams.delete("q")
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
        trail.current = []
        pos.current = 0
        // An earlier send went through without this send's edits, so its code
        // (and any saving) is unknown here: promise no discount.
        setConfirmed({ outcomes: result.children, saved: result.status === "confirmed" ? saved : 0 })
        setAlreadySent(result.status === "already-sent" ? (result.complete ? "all" : "some") : null)
        announce(copy.doneTitle)
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      turnstile.current?.reset()
      if (result.status === "invalid") {
        if (result.field === "submission_key") setSubmissionKey(newSubmissionKey())
        // The year turned since the page loaded, or the phone's clock is off:
        // the refusal brings the server's years, and the year tiles change in
        // place with the entries kept.
        if (result.calendar) setCalendar(result.calendar)
        const shown = refusalShown(result, formRef.current.parent)
        const key = stepForProblem(shown, formRef.current.children)
        if (key) return goTo(key, [shown])
        setProblems([shown])
        focusSoon("[data-form-problem]")
        return
      }
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  const { parent, children, discountCode, done, open } = form
  const currentCode = normalizeDiscountCode(discountCode)
  const answer = currentCode ? (answers[currentCode] ?? null) : null
  const feeEach = answer && "amount" in answer ? answer.amount : STANDARD_INTERVIEW_FEE
  const discountEach = Math.max(0, STANDARD_INTERVIEW_FEE - feeEach)
  const applications = shownApplicationCount(live.applications)
  // From the second question on, Start over shows on the right and the section
  // chip moves above the bar (#513, prototype v55).
  const chipUp = !confirmed && order(children).indexOf(open) > 0
  // On a phone, the box that gets the caret after Space or Enter is brought
  // above the keyboard, below the sticky bar (#513, prototype v54).
  useKeepFocusInView(chipUp ? BAR_INSET_CHIP_UP : BAR_INSET)

  const message = (field: FormField, childIndex: number | null = null) => {
    const problem = problems.find((shown) => shown.field === field && (childIndex === null || shown.child === null || shown.child === childIndex))
    if (!problem) return null
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    if (problem.server && field === "enrollment_year") return copy.problems.year_closed
    if (field === "contact_name" && parent.custodian === "") return copy.chooseCustodian
    if (field === "duplicate_child" && problem.child !== null && children[problem.child]) {
      const key = childNameKey(studentName(children[problem.child]))
      const firstOne = children.slice(0, problem.child).find((child) => childNameKey(studentName(child)) === key) ?? children[problem.child]
      return copy.duplicateChild(studentName(firstOne))
    }
    // A box left empty, which the page found itself. A box too long takes the field's own words.
    if (!problem.server && problem.part) {
      const held = field === "student_name" && problem.child !== null ? children[problem.child] : parent
      const box = (held as Record<string, unknown> | undefined)?.[boxOf(problem.part)]
      const empty = typeof box !== "string" || box.trim() === ""
      if (empty && field === "student_name") return copy.studentNameMissing
      if (empty && field === "contact_name") return copy.custodianNameMissing
    }
    return copy.problems[field]
  }
  // The boxes a name problem marks: the parts it names, or all of them.
  const namesInvalid = (field: "student_name" | "contact_name", childIndex: number | null) => {
    // The same student twice is the whole name: every box is marked.
    if (field === "student_name" && problems.some((shown) => shown.field === "duplicate_child" && shown.child === childIndex)) return "all" as const
    const found = problems.filter((shown) => shown.field === field && (field === "contact_name" || shown.child === childIndex))
    if (found.length === 0) return null
    if (found.some((shown) => !shown.part)) return "all" as const
    return new Set(found.map((shown) => shown.part as NamePart))
  }
  const unplaced = problems.find((shown) => stepForProblem(shown, children) === null)
  const noticeText = notice
    ? { "check-pending": copy.checkPending, "rate-limited": copy.rateLimited, "check-failed": copy.checkFailed, unavailable: copy.unavailable }[notice]
    : null

  // The progress bar follows the student whose question is open, else the last.
  const focusCard = parseKey(open).card ?? children[children.length - 1].card
  const focusIndex = Math.max(0, children.findIndex((child) => child.card === focusCard))
  const groupKeys: StepKey[][] = [STUDENT_KINDS.map((kind) => studentKey(kind, children[focusIndex].card)), ["pname", "rel", "phone"], ["code", "fee"]]
  const labels = [children.length === 1 ? copy.oneStudent : copy.sections[0], copy.sections[1], copy.sections[2]]
  const groups = groupKeys.map((keys, i) => ({
    label: labels[i],
    steps: keys.length,
    done: keys.filter((key) => done.has(key)).length,
    current: keys.includes(open) && !done.has(open) ? keys.indexOf(open) : -1,
  }))
  const activeGroup = open === "send" ? 3 : open === "more" ? 0 : groupKeys.findIndex((keys) => keys.includes(open))
  const who = children.length > 1 ? copy.who(focusIndex + 1) : undefined
  const at = order(children).indexOf(open)
  const status =
    open === "send"
      ? copy.progressDone
      : open === "more"
        ? copy.anotherQ
        : copy.progress(labels[activeGroup], groupKeys[activeGroup].indexOf(open) + 1, groupKeys[activeGroup].length, activeGroup === 0 ? (who ?? null) : null)

  const classCard = sheet?.kind === "class" ? children.find((child) => child.card === sheet.card) : undefined

  return (
    <>
      <BrandTopBar
        variant="schools"
        language={language}
        showLanguagePrompt={showLanguagePrompt}
        returnTo="/apply"
        onClearForm={() => restart(copy.cleared)}
      />
      <h1 className="sr-only">{copy.title}</h1>
      <section className="rounded-[32px] bg-white px-5 py-6 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[40px] sm:px-7 sm:py-8 max-[330px]:rounded-[26px] max-[330px]:px-3">
        {confirmed ? (
          <>
            {/* Every group full; Start over opens a new form at once (v38). */}
            <ProgressBar
              groups={groups.map((group) => ({ ...group, done: group.steps, current: -1 }))}
              activeGroup={3}
              canBack={false}
              onBack={() => {}}
              canReset
              onReset={() => {
                restart(null)
                toast(copy.newFormToast)
              }}
              labels={{ back: copy.back, reset: copy.reset }}
              status={copy.progressFinished}
            />
            <Confirmation
              copy={copy}
              outcomes={confirmed.outcomes}
              alreadySent={alreadySent}
              officePhone={officePhone}
              headingRef={doneHeading}
              savedTotal={confirmed.saved}
              applications={applications}
              onAgain={() => restart(null)}
            />
          </>
        ) : (
          <>
            <ProgressBar
              groups={groups}
              activeGroup={activeGroup}
              whoLabel={who}
              canBack={at > 0}
              onBack={goBack}
              canReset
              endReset
              chipUp={chipUp}
              onReset={askStartOver}
              labels={{ back: copy.back, reset: copy.reset }}
              status={status}
            />
            <form
              noValidate
              onPointerDown={() => {
                lastPointer.current = performance.now()
              }}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement
                // A name box's Enter moves to the next box (it prevents the default).
                if (event.key !== "Enter" || event.defaultPrevented || !(target instanceof HTMLInputElement) || target.type === "radio" || target.type === "checkbox") return
                event.preventDefault()
                void commit(formRef.current.open)
              }}
              onSubmit={(event) => {
                event.preventDefault()
                if (formRef.current.open === "send") onSend(event.currentTarget)
                else void commit(formRef.current.open)
              }}
            >
              <GuidedStack instant={instant}>
                {questionItems({
                  copy,
                  language,
                  years,
                  defaultYear,
                  parent,
                  children,
                  discountCode,
                  done,
                  open,
                  focusOnMount: interacted,
                  expanded,
                  yearOpen,
                  whatsappOn,
                  message,
                  namesInvalid,
                  codeAnswer: answer,
                  codeChecking: currentCode !== null && checking.has(currentCode),
                  feeEach,
                  discountEach,
                  liveDiscount: live.discount,
                  notice: noticeText,
                  formProblem: unplaced ? { field: unplaced.field, text: copy.problems[unplaced.field] } : null,
                  sending,
                  turnstileRef: turnstile,
                  onOpened,
                  on: {
                    commit: (key) => void commit(key),
                    change,
                    child: updateChild,
                    parent: updateParent,
                    custodian: pickCustodian,
                    custodianAgain,
                    tapChoice,
                    code: (value) => {
                      setForm({ ...formRef.current, discountCode: value })
                      clearProblems((shown) => shown.field === "discount_code")
                    },
                    codeBlur: () => void checkCode(formRef.current.discountCode),
                    codeCheck: () => {
                      const value = formRef.current.discountCode
                      if (!value.trim()) return focusSoon("#discount-code")
                      if (!normalizeDiscountCode(value)) return showProblems([{ field: "discount_code", child: null }])
                      void checkCode(value)
                    },
                    classSheet: (card) => setSheet({ kind: "class", card }),
                    toggleYear: (card) =>
                      setYearOpen((current) => {
                        const next = new Set(current)
                        if (next.has(card)) next.delete(card)
                        else next.add(card)
                        return next
                      }),
                    addStudent,
                    removeStudent,
                    expand: (card) => {
                      setExpanded((current) => new Set(current).add(card))
                      focusSoon(`#kh-${card}`)
                    },
                    toggleWhatsapp: () => {
                      if (whatsappOn) updateParent({ whatsapp: "" })
                      setWhatsappOn(!whatsappOn)
                      if (!whatsappOn) focusSoon("#whatsapp")
                    },
                    offer: () => setSheet({ kind: "offer" }),
                  },
                })}
              </GuidedStack>
            </form>
          </>
        )}
      </section>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <ClassSheet
        copy={copy}
        open={sheet?.kind === "class"}
        picked={classCard?.className ?? ""}
        onClose={() => setSheet(null)}
        onPick={(className) => {
          if (!classCard) return
          setSheet(null)
          updateChild(classCard.card, { className }, true)
        }}
      />
      <StartOverSheet
        copy={copy}
        open={sheet?.kind === "start-over"}
        onClose={() => setSheet(null)}
        onClear={() => {
          restart(null)
          toast(copy.resetDone)
        }}
      />
      <OfferSheet
        copy={copy}
        open={sheet?.kind === "offer"}
        onClose={() => setSheet(null)}
        discountEach={discountEach}
        students={children.length}
        applications={applications === null ? null : formatCount(applications)}
      />
    </>
  )
}
