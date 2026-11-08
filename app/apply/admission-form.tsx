"use client"

import { Check, Phone, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react"

import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import { buttonVariants } from "@/components/ui/button"
import {
  childNameKey,
  childrenProblems,
  MAX_CHILDREN,
  parentProblems,
  type AdmissionChild,
  type AdmissionParent,
  type FieldProblem,
  type FormField,
} from "@/lib/admission-form"
import type { Language } from "@/lib/language"
import { discountCodeCookie, normalizeDiscountCode, STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { FORM_NOTICE, FORM_NOTICE_VERSION } from "@/lib/referral-notice"
import { DAY_OR_BOARDING, LEAD_CLASSES, RELATIONSHIPS } from "@/lib/services/leads"
import { cn } from "@/lib/utils"

import { checkDiscountCode, submitAdmissionForm } from "./actions"
import { COPY } from "./copy"
import { clearDraft, emptyChild, EMPTY_PARENT, readDraft, writeDraft, type ChildDraft, type Draft, type ParentDraft } from "./draft"
import type { AdmissionFormState, DiscountCodeCheck } from "./outcome"

// The Admission form, in three steps: the parent, the children (one card
// each, up to MAX_CHILDREN), then a review with the security check and Send
// application. Every entry lives in this component's state, so switching
// language (which re-renders the page around it) never loses one, and a
// draft in sessionStorage (./draft.ts) brings them back after a reload.
//
// Each step has its own history entry (`?step=2`, `?step=3`, keeping `ref`),
// so the phone's Back and Forward move between steps instead of leaving the
// form. A step whose earlier steps aren't complete opens the first one that
// isn't.
//
// The review step also holds the optional Discount code, one for every child,
// and the interview fee. The code is checked when the step opens with one
// filled in, and again whenever the field loses focus with a different code.
// Only a confirmed code brings the fee down; any other answer, or none, shows
// the standard fee. No answer ever stops the form.

type Step = 0 | 1 | 2

// The step a URL asks for: `?step=2` and `?step=3`, else the first.
function stepFromUrl(): Step {
  const step = new URLSearchParams(window.location.search).get("step")
  return step === "2" ? 1 : step === "3" ? 2 : 0
}

// The current URL with `step` set for this step, every other parameter kept.
function stepUrl(step: Step): string {
  const url = new URL(window.location.href)
  if (step === 0) url.searchParams.delete("step")
  else url.searchParams.set("step", String(step + 1))
  return `${url.pathname}${url.search}${url.hash}`
}

// Marks a history entry this form pushed when moving forward, so its own
// Back button can step back through history rather than add to it.
const PUSHED = "admissionFormStep"

// Whether every step after `to`, up to `from`, has an entry this form pushed,
// so `history.go(to - from)` lands on `to`'s own entry instead of leaving a
// later step's entry behind it.
function unwinds(pushed: ReadonlySet<Step>, from: Step, to: Step): boolean {
  for (let later = to + 1; later <= from; later++) if (!pushed.has(later as Step)) return false
  return true
}

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

function asParent(draft: ParentDraft): AdmissionParent {
  return {
    fullName: draft.fullName,
    relationship: draft.relationship as AdmissionParent["relationship"],
    relationshipDescription: draft.relationship === "Other" ? draft.relationshipDescription : undefined,
    phone: draft.phone,
    whatsapp: draft.whatsapp || undefined,
  }
}

function asChild(draft: ChildDraft): AdmissionChild {
  return {
    fullName: draft.fullName,
    className: draft.className as AdmissionChild["className"],
    enrollmentYear: draft.enrollmentYear ?? 0,
    dayOrBoarding: draft.dayOrBoarding as AdmissionChild["dayOrBoarding"],
  }
}

// Where focus goes for a problem: a child's field on its own card. The same
// child twice is fixed in the name.
function fieldSelector({ field, child }: FieldProblem): string {
  const target = `[data-field="${field === "duplicate_child" ? "student_name" : field}"]`
  return child === null ? target : `[data-child="${child}"] ${target}`
}

const PARENT_FIELDS = new Set<FormField>(["contact_name", "relationship", "relationship_description", "phone", "whatsapp"])
const CHILD_FIELDS = new Set<FormField>(["student_name", "class_name", "enrollment_year", "day_or_boarding", "duplicate_child"])

// A problem shown under its field. `server` marks one the server found, which
// for some fields reads differently (a phone it couldn't read, a year that
// closed since the page loaded).
type Shown = FieldProblem & { server: boolean }

// The furthest step the entries allow: a step opens only once every step
// before it is complete.
function reachable(want: Step, parent: ParentDraft, children: ChildDraft[], years: readonly number[]): Step {
  if (want === 0 || parentProblems(asParent(parent)).length > 0) return 0
  if (want === 1 || childrenProblems(children.map(asChild), years).length > 0) return 1
  return 2
}

type Notice = "check-pending" | "rate-limited" | "check-failed" | "unavailable" | null

// "TZS 50,000", the way the school writes amounts.
function tzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

export function AdmissionFormSteps({
  language,
  years,
  officePhone,
  discountCode: startingCode = "",
  rememberDiscountCode = null,
}: {
  language: Language
  years: [number, number]
  officePhone: string
  // Where the Discount code field starts: the Referral link's code, else the
  // one remembered from an earlier link, else empty.
  discountCode?: string
  // The Referral link's code, when the page opened from one: remembered for
  // 30 days from now, replacing any earlier one.
  rememberDiscountCode?: string | null
}) {
  const copy = COPY[language]
  const [step, setStep] = useState<Step>(0)
  const [parent, setParent] = useState<ParentDraft>(EMPTY_PARENT)
  const lastCard = useRef(1)
  const [children, setChildren] = useState<ChildDraft[]>(() => [emptyChild(1)])
  // Made per form opened, kept until a confirmation shows.
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey)
  // Every problem on the step, in the order the fields show; focus goes to
  // the first.
  const [problems, setProblems] = useState<Shown[]>([])
  // Whether the stored draft has been read. Until then nothing is written,
  // so the empty first render never replaces a draft.
  const [restored, setRestored] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirmed, setConfirmed] = useState<Extract<AdmissionFormState, { status: "confirmed" }>["children"] | null>(null)
  // The confirmation is for an earlier send of this form, before an edit:
  // all of its children, or only some.
  const [alreadySent, setAlreadySent] = useState<"all" | "some" | null>(null)
  const [sending, startSending] = useTransition()
  const router = useRouter()
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  // The steps this page pushed a history entry for. The entry's own marker
  // survives a reload, but Next.js rewrites the entry's state when a Server
  // Action (the language switch) refreshes the page, so both are checked.
  const pushedSteps = useRef(new Set<Step>())
  // Sent back to an earlier step's own entry: the problems to show once its
  // popstate arrives, and whether to refresh the page then (a year closed).
  const arriving = useRef<{ step: Step; shown: Shown[]; refresh: boolean } | null>(null)
  // After adding or removing a card: the card to put the reader at, and
  // whether at its name (a new card) or on the card itself, which reads out
  // its legend (where a removed card was).
  const [cardFocus, setCardFocus] = useState<{ index: number; at: "name" | "card" } | null>(null)
  const [discountCode, setDiscountCode] = useState(startingCode)
  // The answer for each code checked so far, and the codes being checked now.
  const [answers, setAnswers] = useState<Record<string, DiscountCodeCheck>>({})
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (!rememberDiscountCode) return
    document.cookie = discountCodeCookie(rememberDiscountCode, { secure: window.location.protocol === "https:" })
  }, [rememberDiscountCode])

  // Brings back the tab's draft and opens the step the URL asks for, or the
  // first one the entries don't complete. Runs once, after hydration, since
  // the server can't see the tab's storage.
  useEffect(() => {
    // The draft's code stands unless a different Referral link opened the
    // page: a reload keeps `ref` in the URL, so the same link again is the
    // same form, and the parent's edit to the code stays.
    const keepsDraftCode = (draft: Draft) => !rememberDiscountCode || draft.linkCode === rememberDiscountCode
    const draft = readDraft(years)
    const want = stepFromUrl()
    const opened = reachable(want, draft?.parent ?? EMPTY_PARENT, draft?.children ?? [emptyChild(1)], years)
    // After this commit, once Next.js has patched history, so its router
    // learns the corrected URL too. A null state lets Next.js add its own.
    if (opened !== want) setTimeout(() => window.history.replaceState(null, "", stepUrl(opened)), 0)
    /* eslint-disable react-hooks/set-state-in-effect -- reading the tab's storage after hydration */
    if (draft) {
      setParent(draft.parent)
      setChildren(draft.children)
      lastCard.current = draft.children.length
      if (keepsDraftCode(draft)) setDiscountCode(draft.discountCode)
    }
    setStep(opened)
    setRestored(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    if (opened === 2) void checkCode(draft && keepsDraftCode(draft) ? draft.discountCode : startingCode)
    // Once, on mount: later changes are the form's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keeps the draft in step with the entries, until a confirmation shows.
  useEffect(() => {
    if (!restored || confirmed) return
    writeDraft({ parent, children, discountCode, linkCode: rememberDiscountCode ?? "" })
  }, [restored, confirmed, parent, children, discountCode, rememberDiscountCode])

  // The phone's Back and Forward: open the step the entry names, as far as
  // the entries allow. A confirmation stays put.
  useEffect(() => {
    function onPopState() {
      if (confirmed) return
      const want = stepFromUrl()
      const opened = reachable(want, parent, children, years)
      // A step the entries don't allow yet goes back to the allowed step's
      // own entry when this form pushed the ones in between, so the form's
      // Back from there still steps back through history. Otherwise the
      // entry is replaced, and is no longer one this form pushed.
      const unwinding = opened !== want && unwinds(pushedSteps.current, want, opened)
      const arrival = arriving.current
      if (!unwinding) arriving.current = null
      if (unwinding) window.history.go(opened - want)
      else if (opened !== want) {
        pushedSteps.current.delete(opened)
        window.history.replaceState(null, "", stepUrl(opened))
      }
      setNotice(null)
      moved.current = true
      setProblems(arrival?.step === opened ? arrival.shown : [])
      setStep(opened)
      // After Next.js has handled this popstate too, so the refresh doesn't
      // race its restore of the entry.
      if (arrival?.refresh && !unwinding) setTimeout(() => router.refresh(), 0)
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [confirmed, parent, children, years, router])

  // After a step change, put the reader at the new step's heading, or at the
  // first field to fix.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const target = problems[0] ? document.querySelector<HTMLElement>(fieldSelector(problems[0])) : heading.current
    target?.focus()
  }, [step, problems, confirmed])

  useEffect(() => {
    if (!cardFocus) return
    const card = `[data-child="${cardFocus.index}"]`
    document.querySelector<HTMLElement>(cardFocus.at === "name" ? `${card} [data-field="student_name"]` : card)?.focus()
  }, [cardFocus])

  // Asks what the code in the field means, unless it already has an answer
  // or is being asked about. A check that couldn't run is asked again on the
  // next blur. A value that isn't a code is named under the field instead.
  async function checkCode(value: string) {
    if (!value.trim()) return
    const code = normalizeDiscountCode(value)
    if (!code) {
      setProblems([{ field: "discount_code", child: null, server: false }])
      return
    }
    if ((answers[code] && "amount" in answers[code]) || checking.has(code)) return
    setChecking((current) => new Set(current).add(code))
    let result: DiscountCodeCheck
    try {
      result = await checkDiscountCode(code)
    } catch {
      result = { status: "unavailable" }
    }
    // Kept by code, so an answer that arrives after the parent typed on
    // still answers for that code if they go back to it.
    setAnswers((current) => ({ ...current, [code]: result }))
    setChecking((current) => {
      const next = new Set(current)
      next.delete(code)
      return next
    })
  }

  // Opens a step. `push` gives it a new history entry (moving forward),
  // `replace` sends the parent back to fix something: to that step's own
  // entry when this form pushed the ones after it, so the phone's Back from
  // there leaves the form, else by swapping the current entry. `refresh`
  // re-renders the page once the step is open.
  function go(next: Step, shown: Shown[] = [], history: "push" | "replace" = "replace", refresh = false) {
    moved.current = true
    setProblems(shown)
    setStep(next)
    const unwinding = history === "replace" && next !== step && unwinds(pushedSteps.current, step, next)
    if (refresh && !unwinding) router.refresh()
    if (history === "push") {
      pushedSteps.current.add(next)
      window.history.pushState({ [PUSHED]: true }, "", stepUrl(next))
    } else if (unwinding) {
      // The popstate opens the step again; these problems stay on show.
      arriving.current = { step: next, shown, refresh }
      window.history.go(next - step)
    } else if (next !== step) {
      // Problems on the step already open leave its history entry alone, so
      // the form's Back still steps back through history.
      pushedSteps.current.delete(next)
      window.history.replaceState(null, "", stepUrl(next))
    }
  }

  // Clears the problems a change fixes, keeping the rest on show.
  function clearProblems(fixed: (shown: Shown) => boolean) {
    setProblems((current) => (current.some(fixed) ? current.filter((shown) => !fixed(shown)) : current))
  }

  function updateParent(change: Partial<ParentDraft>) {
    setParent((current) => ({ ...current, ...change }))
    const fields = new Set<FormField>()
    if ("fullName" in change) fields.add("contact_name")
    if ("relationship" in change) fields.add("relationship").add("relationship_description")
    if ("relationshipDescription" in change) fields.add("relationship_description")
    if ("phone" in change) fields.add("phone")
    if ("whatsapp" in change) fields.add("whatsapp")
    // A problem the server named goes with any edit, as before.
    clearProblems((shown) => fields.has(shown.field) || shown.server)
  }

  function updateChild(index: number, change: Partial<Omit<ChildDraft, "card">>) {
    setChildren((current) => current.map((draft, i) => (i === index ? { ...draft, ...change } : draft)))
    const fields = new Set<FormField>()
    // A name change can end a repeat on any card.
    if ("fullName" in change) fields.add("student_name").add("duplicate_child")
    if ("className" in change) fields.add("class_name")
    if ("enrollmentYear" in change) fields.add("enrollment_year")
    if ("dayOrBoarding" in change) fields.add("day_or_boarding")
    clearProblems(
      (shown) =>
        shown.server ||
        shown.field === "children" ||
        (fields.has(shown.field) && (shown.child === index || shown.field === "duplicate_child")),
    )
  }

  function addChild() {
    if (children.length >= MAX_CHILDREN) return
    lastCard.current += 1
    const card = lastCard.current
    setChildren((current) => [...current, emptyChild(card)])
    clearProblems((shown) => shown.field === "children")
    setCardFocus({ index: children.length, at: "name" })
  }

  function removeChild(index: number) {
    if (children.length <= 1) return
    setChildren((current) => current.filter((_, i) => i !== index))
    // The cards after it move up, so their problems no longer point at them.
    setProblems([])
    setCardFocus({ index: Math.min(index, children.length - 2), at: "card" })
  }

  function onContinue() {
    setNotice(null)
    if (step === 0) {
      const found = parentProblems(asParent(parent))
      if (found.length) return go(0, found.map((shown) => ({ ...shown, server: false })))
      return go(1, [], "push")
    }
    const found = childrenProblems(children.map(asChild), years)
    if (found.length) return go(1, found.map((shown) => ({ ...shown, server: false })))
    go(2, [], "push")
    // A code filled in from a Referral link, or kept from before, is checked
    // as the review step opens; the field's blur checks any edit.
    void checkCode(discountCode)
  }

  // The form's own Back: back through history when this step was reached by
  // moving forward, so the phone's Forward still works; otherwise (a reload,
  // or a step opened from a link) it replaces the entry.
  function onBack() {
    setNotice(null)
    const state: unknown = window.history.state
    const marked = Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[PUSHED])
    if (marked || pushedSteps.current.has(step)) {
      window.history.back()
      return
    }
    go((step - 1) as Step)
  }

  function onSend(form: HTMLFormElement) {
    if (sending) return
    const parentFound = parentProblems(asParent(parent))
    if (parentFound.length) return go(0, parentFound.map((shown) => ({ ...shown, server: false })))
    const childFound = childrenProblems(children.map(asChild), years)
    if (childFound.length) return go(1, childFound.map((shown) => ({ ...shown, server: false })))
    if (discountCode.trim() && !normalizeDiscountCode(discountCode)) {
      return go(2, [{ field: "discount_code", child: null, server: false }])
    }

    const data = new FormData(form)
    // Turnstile fills its token in a moment after the step opens; sending
    // before then would only be refused.
    if (!data.get("cf-turnstile-response")) {
      setNotice("check-pending")
      return
    }
    data.set(
      "form",
      JSON.stringify({
        submissionKey,
        parent: asParent(parent),
        children: children.map(asChild),
        discountCode: discountCode.trim() || undefined,
        // The field has a value, so the code-holder notice is showing.
        noticeVersion: discountCode.trim() ? FORM_NOTICE_VERSION : undefined,
      }),
    )
    setNotice(null)
    setProblems([])
    startSending(async () => {
      let result: AdmissionFormState
      try {
        result = await submitAdmissionForm({ status: "idle" }, data)
      } catch {
        result = { status: "unavailable" }
      }
      if (result.status === "confirmed" || result.status === "already-sent") {
        // The draft goes as soon as the confirmation shows, and the URL
        // drops its step, so a reload opens an empty form.
        clearDraft()
        window.history.replaceState(null, "", stepUrl(0))
        moved.current = true
        setConfirmed(result.children)
        setAlreadySent(result.status === "already-sent" ? (result.complete ? "all" : "some") : null)
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      turnstile.current?.reset()
      if (result.status === "invalid") {
        if (result.field === "submission_key") setSubmissionKey(newSubmissionKey())
        // The year turned since the page loaded: render the new year chips.
        // The entries are client state, so a refresh keeps them.
        const refresh = result.field === "enrollment_year"
        const shown: Shown = { field: result.field, child: result.child, server: true }
        if (PARENT_FIELDS.has(result.field)) return go(0, [shown], "replace", refresh)
        if (CHILD_FIELDS.has(result.field)) return go(1, [shown], "replace", refresh)
        if (refresh) router.refresh()
        moved.current = true
        setProblems([shown])
        return
      }
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  function startAgain() {
    clearDraft()
    setParent(EMPTY_PARENT)
    lastCard.current += 1
    setChildren([emptyChild(lastCard.current)])
    setSubmissionKey(newSubmissionKey())
    // The remembered code still counts for another form, as the page would
    // start it.
    setDiscountCode(startingCode)
    setConfirmed(null)
    setAlreadySent(null)
    setNotice(null)
    go(0)
  }

  if (confirmed) {
    return (
      <Confirmation
        copy={copy}
        outcomes={confirmed}
        alreadySent={alreadySent}
        officePhone={officePhone}
        headingRef={heading}
        onAgain={startAgain}
      />
    )
  }

  const message = (field: FormField, childIndex: number | null = null) => {
    const problem = problems.find(
      (shown) => shown.field === field && (childIndex === null || shown.child === null || shown.child === childIndex),
    )
    if (!problem) return null
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    if (problem.server && field === "enrollment_year") return copy.problems.year_closed
    if (field === "duplicate_child" && problem.child !== null && children[problem.child]) {
      return copy.duplicateChild(duplicateName(children, problem.child))
    }
    return copy.problems[field]
  }
  const formProblem = problems.find(
    (shown) => !PARENT_FIELDS.has(shown.field) && !CHILD_FIELDS.has(shown.field) && shown.field !== "discount_code",
  )
  const formLevel = formProblem ? copy.problems[formProblem.field] : null
  // The answer for the code in the field now, if it has one.
  const currentCode = normalizeDiscountCode(discountCode)
  const answer = currentCode ? (answers[currentCode] ?? null) : null
  const discountNote =
    !currentCode || problems.some((shown) => shown.field === "discount_code")
      ? null
      : checking.has(currentCode)
        ? copy.discountChecking
        : answer?.status === "approved"
          ? copy.discountNotes.approved(answer.discount === null ? null : tzs(answer.discount))
          : answer
            ? copy.discountNotes[answer.status === "rate-limited" || answer.status === "unavailable" ? "unchecked" : answer.status]
            : null
  const feePerChild = answer && "amount" in answer ? answer.amount : STANDARD_INTERVIEW_FEE

  const noticeText = notice
    ? {
        "check-pending": copy.checkPending,
        "rate-limited": copy.rateLimited,
        "check-failed": copy.checkFailed,
        unavailable: copy.unavailable,
      }[notice]
    : null

  return (
    <section className="rounded-[40px] bg-white px-5 py-7 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <div className="flex gap-1.5" aria-hidden>
        {copy.steps.map((title, index) => (
          <div key={title} className={cn("h-1.5 flex-1 rounded-full", index <= step ? "bg-orange-500" : "bg-blue-100")} />
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600">{copy.stepOf(step + 1)}</p>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-1 font-exo text-3xl font-extrabold italic leading-tight text-balance text-blue-600 outline-none"
      >
        {copy.steps[step]}
      </h1>

      <form
        noValidate
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (step < 2) onContinue()
          else onSend(event.currentTarget)
        }}
      >
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <TextField
              id="parent-name"
              field="contact_name"
              label={copy.parentName}
              value={parent.fullName}
              onChange={(fullName) => updateParent({ fullName })}
              autoComplete="name"
              error={message("contact_name")}
            />
            <ChipField
              field="relationship"
              label={copy.relationship}
              options={RELATIONSHIPS.map((value) => ({ value, label: copy.relationships[value] }))}
              value={parent.relationship}
              onPick={(relationship) => updateParent({ relationship })}
              error={message("relationship")}
            />
            {parent.relationship === "Other" && (
              <TextField
                id="relationship-description"
                field="relationship_description"
                label={copy.relationshipDescription}
                value={parent.relationshipDescription}
                onChange={(relationshipDescription) => updateParent({ relationshipDescription })}
                error={message("relationship_description")}
              />
            )}
            <TextField
              id="phone"
              field="phone"
              label={copy.phone}
              hint={copy.phoneHint}
              value={parent.phone}
              onChange={(phone) => updateParent({ phone })}
              type="tel"
              autoComplete="tel"
              error={message("phone")}
            />
            <TextField
              id="whatsapp"
              field="whatsapp"
              label={`${copy.whatsapp} (${copy.optional})`}
              hint={copy.whatsappHint}
              value={parent.whatsapp}
              onChange={(whatsapp) => updateParent({ whatsapp })}
              type="tel"
              error={message("whatsapp")}
            />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            {children.map((draft, index) => (
              <fieldset
                key={draft.card}
                data-child={index}
                tabIndex={-1}
                className="flex min-w-0 flex-col gap-5 rounded-3xl p-4 outline-none ring-1 ring-blue-600/15"
              >
                <legend className="sr-only">
                  {copy.child} {index + 1}
                </legend>
                <div className="flex items-center justify-between gap-3">
                  <p aria-hidden className="font-exo text-base font-bold italic text-orange-700">
                    {copy.child} {index + 1}
                  </p>
                  {children.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeChild(index)}
                      className="-my-1 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-blue-800 outline-none transition hover:bg-red-50 hover:text-red-700 focus-visible:ring-3 focus-visible:ring-blue-600/40"
                    >
                      <X className="size-4" aria-hidden />
                      {copy.removeChild(index + 1)}
                    </button>
                  )}
                </div>
                <TextField
                  id={`child-name-${draft.card}`}
                  field="student_name"
                  label={copy.childName}
                  value={draft.fullName}
                  onChange={(fullName) => updateChild(index, { fullName })}
                  // The child's name, never the parent's own from the phone.
                  autoComplete="off"
                  error={message("student_name", index) ?? message("duplicate_child", index)}
                />
                <ChipField
                  id={`class-${draft.card}`}
                  field="class_name"
                  label={copy.className}
                  options={LEAD_CLASSES.map((value) => ({ value, label: value }))}
                  value={draft.className}
                  onPick={(className) => updateChild(index, { className })}
                  error={message("class_name", index)}
                />
                <ChipField
                  id={`year-${draft.card}`}
                  field="enrollment_year"
                  label={copy.enrollmentYear}
                  options={years.map((year) => ({ value: String(year), label: String(year) }))}
                  value={draft.enrollmentYear === null ? "" : String(draft.enrollmentYear)}
                  onPick={(year) => updateChild(index, { enrollmentYear: Number(year) })}
                  error={message("enrollment_year", index)}
                />
                <ChipField
                  id={`boarding-${draft.card}`}
                  field="day_or_boarding"
                  label={copy.dayOrBoarding}
                  options={DAY_OR_BOARDING.map((value) => ({ value, label: copy.dayOrBoardingOptions[value] }))}
                  value={draft.dayOrBoarding}
                  onPick={(dayOrBoarding) => updateChild(index, { dayOrBoarding })}
                  error={message("day_or_boarding", index)}
                />
              </fieldset>
            ))}
            {children.length < MAX_CHILDREN ? (
              <button
                type="button"
                onClick={addChild}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-blue-600/30 px-4 font-exo text-base font-bold italic text-blue-600 outline-none transition hover:border-blue-600/60 hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
              >
                <Plus className="size-5" aria-hidden />
                {copy.addChild}
              </button>
            ) : (
              <p className="text-center text-sm text-slate-600">{copy.maxChildren(MAX_CHILDREN)}</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <dl className="rounded-3xl bg-blue-50 p-4 ring-1 ring-blue-100">
              <dt className="text-sm font-semibold text-blue-800">{copy.reviewParent}</dt>
              <dd className="mt-1 text-base text-blue-900">
                <span className="font-semibold">{parent.fullName.trim()}</span>
                {" · "}
                {parent.relationship === "Other"
                  ? parent.relationshipDescription.trim()
                  : copy.relationships[parent.relationship as keyof typeof copy.relationships]}
              </dd>
              <dd className="text-base text-blue-900">{parent.phone.trim()}</dd>
              {parent.whatsapp.trim() && (
                <dd className="text-base text-blue-900">
                  {copy.whatsapp}: {parent.whatsapp.trim()}
                </dd>
              )}
              {children.map((draft, index) => (
                <Fragment key={draft.card}>
                  <dt className="mt-4 text-sm font-semibold text-blue-800">
                    {copy.reviewChild} {index + 1}
                  </dt>
                  <dd className="mt-1 text-base font-semibold text-blue-900">{draft.fullName.trim()}</dd>
                  <dd className="text-base text-blue-900">
                    {draft.className} · {draft.enrollmentYear} ·{" "}
                    {copy.dayOrBoardingOptions[draft.dayOrBoarding as keyof typeof copy.dayOrBoardingOptions]}
                  </dd>
                </Fragment>
              ))}
            </dl>

            <DiscountCodeField
              label={copy.discountCode}
              hint={copy.discountCodeHint}
              value={discountCode}
              onChange={(value) => {
                setDiscountCode(value)
                clearProblems((shown) => shown.field === "discount_code" || shown.server)
              }}
              onBlur={() => void checkCode(discountCode)}
              note={discountNote}
              holderNotice={discountCode.trim() ? FORM_NOTICE[language] : null}
              confirmed={answer?.status === "approved"}
              error={message("discount_code")}
            />

            <div className="rounded-3xl bg-orange-50 p-4 ring-1 ring-orange-100">
              <p className="text-sm font-semibold text-orange-950">{copy.interviewFee}</p>
              <p className="mt-1 text-base text-orange-950">{copy.feePerChild(tzs(feePerChild))}</p>
              <p className="mt-0.5 text-base font-semibold text-orange-950">
                {copy.feeTotal(children.length, tzs(feePerChild * children.length))}
              </p>
            </div>

            <div>
              <TurnstileWidget ref={turnstile} action="admission" language={language} />
              <p className="mt-1 text-center text-xs text-slate-500">{copy.securityNote}</p>
            </div>
          </div>
        )}

        {(noticeText || formLevel) && (
          <p
            role="alert"
            tabIndex={-1}
            data-field={formProblem?.field}
            className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 outline-none ring-1 ring-red-200"
          >
            {noticeText ?? formLevel}
          </p>
        )}

        <div className="mt-7 flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={onBack}
              disabled={sending}
              className="h-12 rounded-full border border-blue-600/30 px-6 font-exo text-base font-bold italic text-blue-600 outline-none transition hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 disabled:opacity-70"
            >
              {copy.back}
            </button>
          )}
          <button
            type="submit"
            disabled={sending}
            className={cn(
              buttonVariants({ variant: "orange" }),
              "h-12 flex-1 rounded-full font-exo text-lg italic shadow-md shadow-orange-500/20 transition hover:-translate-y-0.5 active:scale-95 disabled:translate-y-0 disabled:opacity-70",
            )}
          >
            {step < 2 ? copy.continue : sending ? copy.sending : copy.send}
          </button>
        </div>
      </form>
    </section>
  )
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm text-red-600">
      {children}
    </p>
  )
}

function TextField({
  id,
  field,
  label,
  hint,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
}: {
  id: string
  field: FormField
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "tel"
  autoComplete?: string
  error: string | null
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-slate-500">
          {hint}
        </p>
      )}
      <input
        id={id}
        data-field={field}
        type={type}
        inputMode={type === "tel" ? "tel" : undefined}
        autoComplete={autoComplete}
        value={value}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={cn(
          "mt-1.5 h-12 w-full rounded-full border bg-white px-5 text-base text-slate-800 outline-none transition focus-visible:border-blue-600 focus-visible:ring-3 focus-visible:ring-blue-600/20",
          error ? "border-red-500" : "border-blue-600/30",
        )}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

function ChipField({
  id,
  field,
  label,
  options,
  value,
  onPick,
  error,
}: {
  // Unique on the page; the field's name when the field shows once.
  id?: string
  field: FormField
  label: string
  options: { value: string; label: string }[]
  value: string
  onPick: (value: string) => void
  error: string | null
}) {
  const base = id ?? field
  const labelId = `${base}-label`
  return (
    <div>
      <p id={labelId} className="text-sm font-semibold text-slate-700">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={error ? `${base}-error` : undefined}
        data-field={field}
        tabIndex={-1}
        className="mt-2 flex flex-wrap gap-2 outline-none"
      >
        {options.map((option) => {
          const picked = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={picked}
              onClick={() => onPick(option.value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-base outline-none transition focus-visible:ring-3 focus-visible:ring-blue-600/40",
                picked
                  ? "border-blue-600 bg-blue-600 font-semibold text-white"
                  : error
                    ? "border-red-400 bg-white text-slate-800 hover:bg-blue-50"
                    : "border-blue-600/30 bg-white text-slate-800 hover:bg-blue-50",
              )}
            >
              {picked && <Check className="size-4" aria-hidden />}
              {option.label}
            </button>
          )
        })}
      </div>
      {error && <FieldError id={`${base}-error`}>{error}</FieldError>}
    </div>
  )
}

// The optional Discount code, with the note that says what the code means.
// The note is a live region, so a screen reader hears the answer arrive.
// Whenever the field has a value, the code-holder notice (#182) shows under
// it: information only, fixed wording, versioned in lib/referral-notice.ts.
function DiscountCodeField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  note,
  holderNotice,
  confirmed,
  error,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  note: string | null
  holderNotice: string | null
  confirmed: boolean
  error: string | null
}) {
  const id = "discount-code"
  const described = [`${id}-hint`, `${id}-note`, holderNotice ? `${id}-holder-notice` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ")
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-sm text-slate-500">
        {hint}
      </p>
      <input
        id={id}
        data-field="discount_code"
        type="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={value}
        maxLength={40}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={cn(
          "mt-1.5 h-12 w-full rounded-full border bg-white px-5 font-mono text-base uppercase tracking-wide text-slate-800 outline-none transition focus-visible:border-blue-600 focus-visible:ring-3 focus-visible:ring-blue-600/20",
          error ? "border-red-500" : "border-blue-600/30",
        )}
      />
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={cn("mt-1.5 text-sm empty:hidden", confirmed ? "font-semibold text-green-700" : "text-slate-600")}
      >
        {note}
      </p>
      {holderNotice && (
        <p id={`${id}-holder-notice`} data-notice-version={FORM_NOTICE_VERSION} className="mt-1.5 text-sm text-slate-600">
          {holderNotice}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

// The name to give for the child on card `index`, which repeats an earlier
// card: as the parent wrote it there, else as on this card.
function duplicateName(children: ChildDraft[], index: number): string {
  const key = childNameKey(children[index].fullName)
  const first = children.slice(0, index).find((draft) => childNameKey(draft.fullName) === key)
  return (first ?? children[index]).fullName.trim().replace(/\s+/g, " ")
}

function Confirmation({
  copy,
  outcomes,
  alreadySent,
  officePhone,
  headingRef,
  onAgain,
}: {
  copy: (typeof COPY)[Language]
  outcomes: { fullName: string; admissionNumber: string }[]
  alreadySent: "all" | "some" | null
  officePhone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onAgain: () => void
}) {
  return (
    <section className="rounded-[40px] bg-white px-5 py-8 text-center shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-orange-500 text-white">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-4 font-exo text-3xl font-extrabold italic leading-tight text-balance text-blue-600 outline-none">
        {copy.doneTitle}
      </h1>

      <ul className="mt-6 flex flex-col gap-3">
        {outcomes.map((child) => (
          <li key={child.admissionNumber} className="rounded-3xl bg-blue-50 px-4 py-5 ring-1 ring-blue-100">
            <p className="text-base text-blue-900">{child.fullName}</p>
            <p className="mt-2 text-sm font-semibold uppercase tracking-wider text-blue-800">{copy.admissionNumber}</p>
            <p className="mt-1 font-mono text-3xl font-bold leading-tight tracking-wide break-all text-blue-600">
              {child.admissionNumber}
            </p>
          </li>
        ))}
      </ul>

      {alreadySent && (
        <p className="mt-5 rounded-3xl bg-orange-50 px-4 py-3 text-base text-orange-950">
          {alreadySent === "all" ? copy.alreadySent : copy.alreadySentInPart}
        </p>
      )}

      <p className="mt-5 text-base text-slate-800">{outcomes.length > 1 ? copy.keepNumbers : copy.keepNumber}</p>

      <p className="mt-6 text-sm text-slate-600">{copy.call}</p>
      <a
        href={`tel:${officePhone.replaceAll(" ", "")}`}
        className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold italic text-blue-600 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
      >
        <Phone className="size-5" strokeWidth={2} aria-hidden />
        {officePhone}
      </a>

      <button
        type="button"
        onClick={onAgain}
        className="mt-6 flex min-h-11 w-full items-center justify-center rounded-full px-4 text-base text-blue-600 underline underline-offset-4 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
      >
        {copy.again}
      </button>
    </section>
  )
}
