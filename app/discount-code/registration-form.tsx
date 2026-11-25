"use client"

import { Check, ChevronDown, ChevronRight, Copy, MessageCircle, Phone, Plus } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react"
import { toast } from "sonner"

import { BrandTopBar } from "@/components/brand"
import {
  BottomSheet,
  ChangeLink,
  ChoiceTiles,
  AgentCodeBox,
  ContinuePill,
  FieldError,
  FieldInput,
  GuidedNote,
  GuidedStack,
  GuidedStep,
  Hint,
  NoticeBox,
  PersonNameBoxes,
  ProgressBar,
  QuestionTitle,
  revealStep,
  SummaryRow,
  type PersonName,
} from "@/components/guided-form"
import { rainConfetti } from "@/components/kit/confetti"
import { FinishMark } from "@/components/kit/states"
import { buttonVariants } from "@/components/ui/button"
import { agentCodePrefix, agentFullName, agentRegistrationProblem, type AgentDraft, type AgentField } from "@/lib/agent-registration"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { clearDraft, readDraft, writeDraft } from "./draft"
import { clearFlow, readFlow, type SavedStep } from "./flow-state"
import { CARD } from "./frame"
import { registerAsAgent } from "./actions"
import { QuietCheck, useQuietCheck } from "./quiet-check"
import { SelfConfirmFlow } from "./self-confirm-flow"
import { SELF_CONFIRM_COPY } from "./self-confirm-copy"
import { COPY, discountWords } from "./copy"
import type { DiscountCodeMessage, DiscountCodeState } from "./outcome"

// The Discount code page's form and its confirmation, in concept C as
// prototype v38 draws it: one question at a time, answered ones folding into
// a line with a two-word "Badilisha …" link. The entries live in this
// component's state, so the menu's language switch (which re-renders the page
// around it) or a refused send never loses one.
//
// - The name is three boxes, First, Middle and Last, all required.
// - "Do you already have a Discount code?" Yes opens the code box, which adds
//   the hyphen by itself, and claims that code (#193). No goes straight to
//   the review: the database makes a new code from the initials.
// - The page never shows another agent's code. The review shows only the
//   person's own initials; the whole code appears on their finished screen.
// - The bar swaps as the Admission form's does (#503 slice 4d, prototype
//   v63): Start over on the left of the first question, then Back there and
//   Start over on the right, with the section name above the bar. With
//   answers it asks first, in a sheet; on an empty form it says there is
//   nothing to clear. A finished screen has no bar at all.
// - The answers stay in the tab's sessionStorage (./draft.ts) through a
//   reload, until "Futa fomu yote", Start over or a finished form clears them.
// - Tapping the answer already chosen moves on, with Space or Enter too.

const EMPTY: AgentDraft = { firstName: "", middleName: "", lastName: "", phone: "", whatsapp: "", email: "", hasCode: false, code: "" }
const NAME_KEYS = ["firstName", "middleName", "lastName"] as const

type Copy = (typeof COPY)[Language]
type Done = Extract<DiscountCodeState, { status: "registered" | "claimed" }>
// A problem shown under its field. `server` marks a phone or code the
// database couldn't read, which reads differently from an empty one.
type Shown = { field: AgentField; server: boolean }
type Notice = "check-pending" | DiscountCodeMessage | null
type Step = "name" | "phone" | "email" | "has" | "code" | "send"
type CodeAnswer = "yes" | "no" | null

const ORDER: Step[] = ["name", "phone", "email", "has", "code", "send"]
// The step each field is asked on. The draft is checked in this same order
// (lib/agent-registration.ts), so the first problem names the earliest step.
const FIELD_STEP: Record<AgentField, Step> = { full_name: "name", phone: "phone", whatsapp: "phone", email: "email", code: "code" }
// The progress bar: Wewe holds the name (1), then phone and WhatsApp (2 and
// 3); Code holds the email (when asked), the question, the code box and the review.
const YOU_STEPS = 3
// How long a picked tile shows its tick before the form moves on.
const TILE_PAUSE_MS = 240

// Answers that aren't a problem with the form: shown calmly.
const CALM = new Set<Notice>(["claim-waiting", "invited", "joined"])

// A step the form passes over: the code box, unless the answer is Yes.
const skipped = (step: Step, answer: CodeAnswer) => step === "code" && answer !== "yes"

function noticeText(copy: Copy, notice: Exclude<Notice, null>): string {
  switch (notice) {
    case "check-pending":
      return copy.checkPending
    case "rate-limited":
      return copy.rateLimited
    case "check-failed":
      return copy.checkFailed
    case "unavailable":
      return copy.unavailable
    default:
      return copy.messages[notice]
  }
}

// `discount` is the interview discount in whole TZS, or null when the page
// couldn't read it.
export function DiscountCodeForm({
  language,
  officePhone,
  discount = null,
  showLanguagePrompt = false,
  selfConfirmOrder = false,
}: {
  language: Language
  officePhone: string
  discount?: number | null
  showLanguagePrompt?: boolean
  // Self-confirm is on (#503 slice 4d-b): no email question before the send;
  // it is asked on the email path, or when a send needs one.
  selfConfirmOrder?: boolean
}) {
  const copy = COPY[language]
  const [draft, setDraft] = useState<AgentDraft>(EMPTY)
  const [whatsappOn, setWhatsappOn] = useState(false)
  const [codeAnswer, setCodeAnswer] = useState<CodeAnswer>(null)
  const [open, setOpen] = useState<Step>("name")
  const [answered, setAnswered] = useState<ReadonlySet<Step>>(new Set())
  const [instant, setInstant] = useState(false)
  const [problem, setProblem] = useState<Shown | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [done, setDone] = useState<Done | null>(null)
  // Self-confirm (#503): code and names matched; the choice of sign-in follows.
  const [selfConfirm, setSelfConfirm] = useState<Extract<DiscountCodeState, { status: "self-confirm" }> | null>(null)
  // When its attempt opened, and the step a reload comes back to (./flow-state.ts).
  const [flowStart, setFlowStart] = useState<{ startedAt: number; step?: SavedStep; smsOff: boolean }>({ startedAt: 0, smsOff: false })
  const [confirming, setConfirming] = useState(false)
  const [sending, startSending] = useTransition()
  // Counts restarts, so an answer to a send from before a restart is ignored.
  const round = useRef(0)
  // The round the self-confirm flow on screen belongs to: a late reply from a
  // flow the form has since cleared must not clear the newer form's draft.
  const flowRound = useRef(0)
  // The security check, out of sight unless it is slow or fails (prototype v5).
  const check = useQuietCheck()
  const form = useRef<HTMLFormElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  const tileTimer = useRef<number | undefined>(undefined)
  // The draft is read once, after hydration, before it is written back.
  const [restored, setRestored] = useState(false)
  // In self-confirm's order, a send that needs the email (today's claim path)
  // brings the email question back; so does a draft that already holds one.
  const [emailNeeded, setEmailNeeded] = useState(false)
  const askEmail = !selfConfirmOrder || emailNeeded || answered.has("email")
  const skip = (step: Step, answer: CodeAnswer) => skipped(step, answer) || (step === "email" && !askEmail)

  // What gets checked and sent: WhatsApp only while its field is shown, the
  // code only after Yes.
  const entries: AgentDraft = {
    ...draft,
    whatsapp: whatsappOn ? draft.whatsapp : "",
    hasCode: codeAnswer === "yes",
    code: codeAnswer === "yes" ? draft.code : "",
  }
  const fullName = agentFullName(draft)

  useEffect(() => () => window.clearTimeout(tileTimer.current), [])

  // Brings back the tab's draft once, after hydration, and opens the first
  // question not answered yet.
  useEffect(() => {
    const saved = readDraft()
    /* eslint-disable react-hooks/set-state-in-effect -- reading the tab's storage after hydration */
    if (saved) {
      const { answered: steps, whatsappOn: wa, codeAnswer: answer, ...typed } = saved
      const now = new Set<Step>(steps)
      setDraft({ ...EMPTY, ...typed, hasCode: answer === "yes" })
      setWhatsappOn(wa)
      setCodeAnswer(answer)
      setAnswered(now)
      const asks = !selfConfirmOrder || now.has("email")
      setOpen(ORDER.find((k) => !now.has(k) && !skipped(k, answer) && (asks || k !== "email")) ?? "send")
      setInstant(true)
      window.setTimeout(() => setInstant(false), 0)
    }
    // A reload while choosing how to sign in comes back to that step.
    const flow = readFlow()
    if (flow) {
      flowRound.current = round.current
      setFlowStart({ startedAt: flow.startedAt, step: flow.step, smsOff: flow.smsOff })
      setSelfConfirm(flow.started)
    }
    setRestored(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    // Once, after hydration: the order is the page's own and never changes.
  }, [selfConfirmOrder])

  // Keeps the draft in step with the answers until the form is sent and done.
  useEffect(() => {
    if (!restored || done) return
    const { firstName, middleName, lastName, phone, whatsapp, email, code } = draft
    writeDraft({ firstName, middleName, lastName, phone, whatsapp, whatsappOn, email, codeAnswer, code, answered: [...answered] })
  }, [restored, done, draft, whatsappOn, codeAnswer, answered])

  // After a problem or a send, put the reader at the field to fix, or at the
  // confirmation. Runs after the step's own focus, so it wins.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    let target: HTMLElement | null = heading.current
    if (problem?.field === "full_name") {
      const boxes = NAME_KEYS.map((key) => document.getElementById(`name-${key}`) as HTMLInputElement | null)
      target = boxes.find((box) => box && !box.value.trim()) ?? boxes[0]
    } else if (problem) target = document.querySelector<HTMLElement>(`[data-field="${problem.field}"]`)
    target?.focus({ preventScroll: problem !== null })
  }, [problem, done, open])

  function update(change: Partial<AgentDraft>) {
    setDraft((current) => ({ ...current, ...change }))
    setProblem(null)
  }

  function show(shown: Shown) {
    moved.current = true
    if (shown.field === "whatsapp") setWhatsappOn(true)
    setProblem(shown)
    setOpen(FIELD_STEP[shown.field])
  }


  // The problem on this step or an earlier one, or null.
  function problemUpTo(step: Step): AgentField | null {
    const found = agentRegistrationProblem(entries, { emailLater: !askEmail })
    if (!found) return null
    return ORDER.indexOf(FIELD_STEP[found]) <= ORDER.indexOf(step) ? found : null
  }

  function next(step: Step, answer: CodeAnswer = codeAnswer, to?: Step) {
    const found = problemUpTo(step)
    if (found) return show({ field: found, server: false })
    const now = new Set(answered).add(step)
    setAnswered(now)
    setProblem(null)
    setOpen(to ?? ORDER.find((k) => !now.has(k) && !skip(k, answer)) ?? "send")
  }

  function openStep(step: Step) {
    // A tile picked a moment ago would otherwise move on over this choice.
    window.clearTimeout(tileTimer.current)
    if (step === open) return
    // Leaving the send: a send waiting on the security check no longer goes on.
    if (open === "send") check.cancel()
    // Leaving an answered step half-fixed would fold a wrong answer away.
    if (open !== "send" && answered.has(open)) {
      const found = problemUpTo(open)
      if (found) return show({ field: found, server: false })
    }
    setProblem(null)
    setOpen(step)
  }

  function back() {
    let i = ORDER.indexOf(open) - 1
    while (i > 0 && skip(ORDER[i], codeAnswer)) i -= 1
    openStep(ORDER[Math.max(0, i)])
  }

  // Yes opens the code box, even one already answered: Change Code comes
  // here, so Yes is how the code gets fixed (Greptile, #544). No goes
  // straight to the review. Picking the same answer again (after Back,
  // Change Code or a reload) moves on too.
  function answerHasCode(value: string) {
    const answer = value as Exclude<CodeAnswer, null>
    setCodeAnswer(answer)
    setProblem(null)
    window.clearTimeout(tileTimer.current)
    tileTimer.current = window.setTimeout(() => next("has", answer, answer === "yes" ? "code" : undefined), TILE_PAUSE_MS)
  }

  function startOver() {
    // A send still in flight belongs to the form being cleared; its answer is ignored.
    round.current += 1
    window.clearTimeout(tileTimer.current)
    clearDraft()
    setDraft(EMPTY)
    // A new form asks in the page's own order again (Sol, #538).
    setEmailNeeded(false)
    setWhatsappOn(false)
    setCodeAnswer(null)
    setAnswered(new Set())
    setOpen("name")
    setProblem(null)
    setNotice(null)
    setDone(null)
    setSelfConfirm(null)
    clearFlow()
    setConfirming(false)
    check.cancel()
    // A full restart skips the fold animations, for that one render.
    setInstant(true)
    window.setTimeout(() => setInstant(false), 0)
  }

  const nothingYet = answered.size === 0 && codeAnswer === null && !whatsappOn && Object.values(draft).every((v) => v === "" || v === false)

  // Start over on the first question: a toast on an empty form, the sheet otherwise.
  function askStartOver() {
    if (nothingYet) toast(copy.nothingToClear)
    else setConfirming(true)
  }

  function onSend() {
    if (sending || !form.current) return
    const found = agentRegistrationProblem(entries, { emailLater: !askEmail })
    if (found) return show({ field: found, server: false })

    const data = new FormData(form.current)
    // Turnstile fills its token in a moment after the step opens. Sent before
    // then, the button waits and the form sends by itself once it passes.
    const token = data.get("cf-turnstile-response") || check.token()
    if (!token) {
      setNotice(null)
      check.begin(() => sendNow.current())
      return
    }
    data.set("cf-turnstile-response", token)
    data.set("firstName", entries.firstName)
    data.set("middleName", entries.middleName)
    data.set("lastName", entries.lastName)
    data.set("phone", entries.phone)
    data.set("whatsapp", entries.whatsapp)
    data.set("email", askEmail ? entries.email : "")
    // Self-confirm's order: the server asks for the email when it needs one.
    data.set("flow", askEmail ? "" : "self-confirm")
    data.set("has_code", entries.hasCode ? "yes" : "no")
    data.set("code", entries.code)
    setNotice(null)
    setProblem(null)
    const sentIn = round.current
    startSending(async () => {
      let result: DiscountCodeState
      try {
        result = await registerAsAgent({ status: "idle" }, data)
      } catch {
        result = { status: "unavailable" }
      }
      if (round.current !== sentIn) return
      if (result.status === "registered" || result.status === "claimed") {
        // Sent and done: a reload opens an empty form.
        clearDraft()
        moved.current = true
        setDone(result)
        return
      }
      if (result.status === "self-confirm") {
        flowRound.current = sentIn
        setFlowStart({ startedAt: Date.now(), smsOff: false })
        setSelfConfirm(result)
        return
      }
      if (result.status === "email-needed") {
        // Today's claim path, or self-confirm off since the page loaded: the
        // email question comes back, before a send again.
        check.reset()
        moved.current = true
        setEmailNeeded(true)
        setOpen("email")
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      check.reset()
      if (result.status === "invalid") return show({ field: result.field, server: true })
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  // The send the check runs by itself once it passes: always the latest one,
  // with the answers as they are then.
  const sendNow = useRef(onSend)
  useEffect(() => {
    sendNow.current = onSend
  })

  const topBar = <BrandTopBar variant="complex" language={language} showLanguagePrompt={showLanguagePrompt} onClearForm={startOver} />

  if (selfConfirm) {
    return (
      <>
        {topBar}
        <SelfConfirmFlow
          key={selfConfirm.attempt}
          language={language}
          officePhone={officePhone}
          started={selfConfirm}
          startedAt={flowStart.startedAt}
          initialStep={flowStart.step}
          initialSmsOff={flowStart.smsOff}
          // The email is on its way or the password is being set: the answers are no longer needed.
          onFinished={() => {
            if (round.current === flowRound.current) clearDraft()
          }}
          // Asked on the form: back to its question. Otherwise the flow asks again itself.
          onChangeEmail={
            askEmail
              ? () => {
                  clearFlow()
                  setSelfConfirm(null)
                  setOpen("email")
                }
              : undefined
          }
          // A new agent's email path: the code is theirs, and the set-password
          // email follows the office's approval, as today.
          onRegistered={(registered) => {
            if (round.current !== flowRound.current) return
            clearDraft()
            clearFlow()
            moved.current = true
            setSelfConfirm(null)
            setDone(registered)
          }}
        />
      </>
    )
  }

  if (done) {
    return (
      <>
        {topBar}
        <Confirmation
          copy={copy}
          done={done}
          officePhone={officePhone}
          headingRef={heading}
        />
      </>
    )
  }

  const message = (field: AgentField) => {
    if (problem?.field !== field) return undefined
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    if (problem.server && field === "code") return copy.problems.code_unreadable
    return copy.problems[field]
  }
  // The name boxes to mark: the empty ones, or all three when none is empty
  // (the whole name is too long, or the database refused it).
  const nameInvalid = (() => {
    if (problem?.field !== "full_name") return undefined
    const empty = NAME_KEYS.filter((key) => !draft[key].trim())
    const marked = empty.length > 0 ? empty : NAME_KEYS
    return Object.fromEntries(marked.map((key) => [key, true])) as Partial<Record<keyof PersonName, boolean>>
  })()

  // Enter moves on, as the pill does.
  const onEnter = (step: Step) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    event.preventDefault()
    next(step)
  }

  const focusFirstField = (li: HTMLLIElement) => {
    // A step folding out as it leaves remounts and can report itself opened.
    if (!li.classList.contains("gf-open")) return
    const target = li.querySelector<HTMLElement>(".gf-fold input:not([type=hidden])") ?? li.querySelector<HTMLElement>(".gf-fold h2")
    target?.focus({ preventScroll: true })
    revealStep(li)
  }

  const visible = (step: Step) => !skip(step, codeAnswer) && (answered.has(step) || open === step)
  const stateOf = (step: Step) => (open === step ? "open" : "folded")
  const change = (step: Step, label: string) => (
    <ChangeLink small onClick={() => openStep(step)}>
      {label}
    </ChangeLink>
  )
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined

  const youDone = (answered.has("name") ? 1 : 0) + (answered.has("phone") ? 2 : 0)
  // The code box counts as done once No has passed it by.
  const codeBoxDone = codeAnswer === "yes" ? answered.has("code") : answered.has("has")
  const codeKeys: Step[] = askEmail ? ["email", "has", "code", "send"] : ["has", "code", "send"]
  const codeSteps = codeKeys.length
  const codeDone = askEmail && !answered.has("email") ? 0 : (askEmail ? 1 : 0) + (answered.has("has") ? (codeBoxDone ? 2 : 1) : 0)
  const activeGroup = open === "name" || open === "phone" ? 0 : 1
  const position = activeGroup === 0 ? (open === "name" ? 1 : 2) : Math.max(0, codeKeys.indexOf(open)) + 1
  const status =
    open === "send"
      ? copy.progressDone
      : activeGroup === 0
        ? copy.progress(copy.groups.you, position, YOU_STEPS)
        : copy.progress(copy.groups.code, position, codeSteps)

  return (
    <>
      {topBar}
      <h1 className="sr-only">{copy.title}</h1>
      <section className={CARD}>
        <ProgressBar
          groups={[
            { label: copy.groups.you, steps: YOU_STEPS, done: youDone, current: activeGroup === 0 ? position - 1 : undefined },
            { label: copy.groups.code, steps: codeSteps, done: codeDone, current: activeGroup === 1 ? position - 1 : undefined },
          ]}
          activeGroup={activeGroup}
          canBack={open !== "name"}
          onBack={back}
          canReset
          endReset
          chipUp={open !== "name"}
          onReset={askStartOver}
          labels={{ back: copy.back, reset: copy.startOver }}
          status={status}
        />

        <form
          ref={form}
          noValidate
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (open === "send") onSend()
            else if (open !== "has") next(open)
          }}
        >
          <GuidedStack instant={instant}>
            <GuidedNote key="intro">
              <NoticeBox tone="info" className="mb-4">
                {copy.intro(discount === null ? null : `TZS ${discount.toLocaleString("en-US")}`)}
              </NoticeBox>
            </GuidedNote>

            {visible("name") && (
              <GuidedStep
                key="name"
                state={stateOf("name")}
                onOpened={focusFirstField}
                summary={answered.has("name") && <SummaryRow stacked label={copy.fullName} value={fullName} action={change("name", copy.change.name)} />}
              >
                <QuestionTitle id="name-title">{copy.nameQuestion}</QuestionTitle>
                <div className="flex flex-col gap-2">
                  <Hint id="name-hint" className="-mt-2 text-center">
                    {copy.nameHint}
                  </Hint>
                  <PersonNameBoxes
                    id="name"
                    aria-labelledby="name-title"
                    aria-describedby={describedBy("name-hint", !!message("full_name") && "name-error")}
                    labels={copy.names}
                    value={{ firstName: draft.firstName, middleName: draft.middleName, lastName: draft.lastName }}
                    onChange={(name) => update(name)}
                    invalid={nameInvalid}
                  />
                  <FieldError id="name-error" message={message("full_name")} />
                </div>
                <ContinuePill onClick={() => next("name")}>{copy.next}</ContinuePill>
              </GuidedStep>
            )}

            {visible("phone") && (
              <GuidedStep
                key="phone"
                state={stateOf("phone")}
                onOpened={focusFirstField}
                openOnMount
                summary={
                  answered.has("phone") && (
                    <SummaryRow
                      stacked
                      label={copy.phone}
                      value={draft.phone.trim()}
                      sub={entries.whatsapp.trim() ? `WhatsApp ${entries.whatsapp.trim()}` : undefined}
                      action={change("phone", copy.change.phone)}
                    />
                  )
                }
              >
                <QuestionTitle htmlFor="phone">{copy.phoneQuestion}</QuestionTitle>
                <div className="flex flex-col gap-2">
                  <Hint id="phone-hint">{copy.phoneHint}</Hint>
                  <FieldInput
                    id="phone"
                    name="phone"
                    data-field="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0712 345 678"
                    enterKeyHint="next"
                    icon={<Phone className="size-5" strokeWidth={1.75} aria-hidden />}
                    value={draft.phone}
                    onChange={(event) => update({ phone: event.target.value })}
                    onKeyDown={onEnter("phone")}
                    maxLength={200}
                    invalid={!!message("phone")}
                    aria-describedby={describedBy("phone-hint", !!message("phone") && "phone-error")}
                  />
                  <FieldError id="phone-error" message={message("phone")} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <ChangeLink aria-expanded={whatsappOn} aria-controls="whatsapp-field" onClick={() => setWhatsappOn((on) => !on)}>
                    {whatsappOn ? <ChevronDown className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                    {copy.whatsappDifferent}
                  </ChangeLink>
                  {whatsappOn && (
                    <div id="whatsapp-field" className="flex w-full flex-col gap-1.5">
                      <label htmlFor="whatsapp" className="text-[15px] font-semibold text-slate-800">
                        {copy.whatsapp} <span className="font-normal text-slate-500">({copy.optional})</span>
                      </label>
                      <FieldInput
                        id="whatsapp"
                        name="whatsapp"
                        data-field="whatsapp"
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        placeholder="0712 345 678"
                        icon={<MessageCircle className="size-5" strokeWidth={1.75} aria-hidden />}
                        value={draft.whatsapp}
                        onChange={(event) => update({ whatsapp: event.target.value })}
                        onKeyDown={onEnter("phone")}
                        maxLength={200}
                        invalid={!!message("whatsapp")}
                        aria-describedby={describedBy(!!message("whatsapp") && "whatsapp-error")}
                      />
                      <FieldError id="whatsapp-error" message={message("whatsapp")} />
                    </div>
                  )}
                </div>
                <ContinuePill onClick={() => next("phone")}>{copy.next}</ContinuePill>
              </GuidedStep>
            )}

            {visible("email") && (
              <GuidedStep
                key="email"
                state={stateOf("email")}
                onOpened={focusFirstField}
                openOnMount
                summary={answered.has("email") && <SummaryRow stacked label={copy.email} value={<span className="wrap-anywhere">{draft.email.trim()}</span>} action={change("email", copy.change.email)} />}
              >
                <QuestionTitle htmlFor="email">{copy.emailQuestion}</QuestionTitle>
                <div className="flex flex-col gap-2">
                  <Hint id="email-hint">{copy.emailHint}</Hint>
                  <FieldInput
                    id="email"
                    name="email"
                    data-field="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="next"
                    value={draft.email}
                    onChange={(event) => update({ email: event.target.value })}
                    onKeyDown={onEnter("email")}
                    maxLength={254}
                    invalid={!!message("email")}
                    aria-describedby={describedBy("email-hint", !!message("email") && "email-error")}
                  />
                  <FieldError id="email-error" message={message("email")} />
                </div>
                <ContinuePill onClick={() => next("email")}>{copy.next}</ContinuePill>
              </GuidedStep>
            )}

            {visible("has") && (
              <GuidedStep
                key="has"
                state={stateOf("has")}
                // After Yes the folded question shows nothing: the code's row stands for both (owner, prototype v5).
                className={codeAnswer === "yes" && open !== "has" ? "hidden" : undefined}
                onOpened={focusFirstField}
                openOnMount
                summary={
                  // One Discount code row, not the question's Yes/No (owner, prototype v5):
                  // "None" here after No; after Yes the code's own step carries the row.
                  answered.has("has") &&
                  codeAnswer === "no" && <SummaryRow stacked label={copy.codeRow} value={copy.none} none action={change("has", copy.change.code)} />
                }
              >
                {/* A click, Space or Enter on the answer already chosen fires no change,
                    so this wrapper carries it on (the Space-on-a-checked-radio trap). */}
                <div
                  onClick={(event) => {
                    const target = event.target as HTMLElement
                    if (target instanceof HTMLInputElement && target.type === "radio") answerHasCode(target.value)
                  }}
                  onKeyDown={(event) => {
                    const target = event.target as HTMLElement
                    if ((event.key === " " || event.key === "Enter") && target instanceof HTMLInputElement && target.type === "radio" && target.checked) {
                      event.preventDefault()
                      answerHasCode(target.value)
                    }
                  }}
                >
                <ChoiceTiles
                  name="has_code_answer"
                  legend={<QuestionTitle>{copy.hasCode}</QuestionTitle>}
                  layout="two"
                  options={[
                    { value: "yes", label: copy.yes },
                    { value: "no", label: copy.no },
                  ]}
                  value={codeAnswer}
                  onChange={answerHasCode}
                  describedBy="has-code-hint"
                >
                  <Hint id="has-code-hint" className="text-center">
                    {copy.hasCodeHint}
                  </Hint>
                </ChoiceTiles>
                </div>
              </GuidedStep>
            )}

            {visible("code") && (
              <GuidedStep
                key="code"
                state={stateOf("code")}
                onOpened={focusFirstField}
                openOnMount
                summary={answered.has("code") && <SummaryRow stacked label={copy.codeRow} value={entries.code.trim()} action={change("has", copy.change.code)} />}
              >
                <QuestionTitle htmlFor="code">{copy.code}</QuestionTitle>
                <div className="flex flex-col gap-2">
                  <Hint id="code-hint">{copy.codeHint}</Hint>
                  <AgentCodeBox
                    id="code"
                    name="code"
                    data-field="code"
                    placeholder={copy.codePlaceholder}
                    enterKeyHint="next"
                    value={draft.code}
                    onValueChange={(code) => update({ code })}
                    invalid={!!message("code")}
                    aria-describedby={describedBy("code-hint", !!message("code") && "code-error")}
                  />
                  <FieldError id="code-error" message={message("code")} />
                </div>
                <ContinuePill onClick={() => next("code")}>{copy.next}</ContinuePill>
              </GuidedStep>
            )}

            {open === "send" && (
              <GuidedStep key="send" state="open" onOpened={focusFirstField} openOnMount>
                <QuestionTitle>{copy.reviewQuestion}</QuestionTitle>
                <Hint className="-mt-2">{copy.reviewHint}</Hint>
                {/* Only the person's own initials: the whole code shows after sending. */}
                <NoticeBox tone="info">
                  {/* In self-confirm's order a code holder's names are matched, then they
                      choose how to sign in (O-N1); a new agent sees the code at the end (O-N61). */}
                  {entries.hasCode ? (
                    askEmail ? copy.claimNote : SELF_CONFIRM_COPY[language].reviewNote
                  ) : (
                    <>
                      {copy.newCodeNote.before}
                      <b data-initials>{agentCodePrefix(fullName)}</b>
                      {askEmail ? copy.newCodeNote.after : copy.newCodeNoteAtEnd}
                    </>
                  )}
                </NoticeBox>
                {notice && (
                  <NoticeBox tone={CALM.has(notice) ? "info" : "bad"} role="alert">
                    {noticeText(copy, notice)}
                    {notice === "joined" && (
                      <>
                        {" "}
                        <Link href="/auth" className="font-semibold underline underline-offset-4">
                          {copy.signIn}
                        </Link>
                      </>
                    )}
                  </NoticeBox>
                )}
                {/* Inside the form, so its token is sent; invisible unless Cloudflare
                    needs a click, and then right above Send. A slow or failed check
                    says so here, with Run the check again. */}
                <QuietCheck check={check} language={language} />
                <ContinuePill type="submit" pending={sending || check.waiting} disabled={sending || check.waiting}>
                  {sending || check.waiting ? copy.sending : entries.hasCode ? copy.sendClaim : copy.send}
                </ContinuePill>
              </GuidedStep>
            )}
          </GuidedStack>
        </form>

        {/* Kept apart from "Do you already have a Discount code?": this one is
            for someone who has already set a password. */}
        <p className="mt-6 text-center text-sm text-slate-600">
          {copy.signInPrompt}{" "}
          <Link
            href="/auth"
            className="font-semibold text-blue-600 underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
          >
            {copy.signIn}
          </Link>
        </p>
      </section>

      <BottomSheet open={confirming} onClose={() => setConfirming(false)} title={copy.startOverSheet.title} closeLabel={copy.startOverSheet.close}>
        <div className="flex flex-col gap-3">
          <Hint>{copy.startOverSheet.body}</Hint>
          <NoticeBox tone="bad">{copy.startOverSheet.warning}</NoticeBox>
          <button
            type="button"
            className="dc-clear inline-flex min-h-13 w-full items-center justify-center rounded-full border-[1.5px] border-[#c81e1e] bg-white px-6 font-exo text-lg font-semibold text-[#c81e1e] italic outline-none hover:bg-red-50 focus-visible:ring-3 focus-visible:ring-red-700/40 active:scale-[0.97]"
            onClick={() => {
              startOver()
              toast(copy.clearedToast)
            }}
          >
            {copy.startOverSheet.yes}
          </button>
          <ContinuePill variant="ghost" onClick={() => setConfirming(false)}>
            {copy.startOverSheet.no}
          </ContinuePill>
        </div>
      </BottomSheet>
    </>
  )
}

const OUTLINED_PILL =
  "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring) active:scale-[0.97]"

function Note({ tone, children }: { tone: "wait" | "info"; children: ReactNode }) {
  return (
    <NoticeBox tone={tone} className="w-full text-[15px]">
      {children}
    </NoticeBox>
  )
}

function Confirmation({
  copy,
  done,
  officePhone,
  headingRef,
}: {
  copy: Copy
  done: Done
  officePhone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)
  const mark = useRef<HTMLSpanElement>(null)
  // The kit's finish confetti, once the mark's tick has drawn (DESIGN.md, Confetti).
  useEffect(() => rainConfetti(mark.current), [])
  const shareHref = discountCodeShareLink(copy.shareText(done.code, done.link, discountWords(done.discount)))

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(done.link)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <section className={cn(CARD, "flex flex-col items-center gap-4 text-center")}>
      {/* Sent: no progress bar and no Start over (owner, prototype v61). */}
      <FinishMark ref={mark} />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic outline-none"
      >
        {done.status === "registered" ? copy.doneTitle : copy.claimDoneTitle}
      </h1>
      <p
        data-own-code
        className="max-w-full rounded-2xl border-[1.5px] border-dashed border-blue-600/40 px-6 py-2 font-exo text-[2.5rem] leading-tight font-extrabold tracking-wide wrap-anywhere text-blue-600 italic tabular-nums max-[330px]:text-[2rem]"
      >
        {done.code}
      </p>

      <div className="flex w-full flex-col gap-3 text-left">
        <p className="text-sm font-semibold text-slate-700">{copy.linkLabel}</p>
        <p className="-mt-1.5 rounded-2xl bg-[#f8f7fd] px-4 py-3 font-mono text-sm break-all text-slate-800 ring-1 ring-blue-600/15 select-all">
          {done.link}
        </p>
        <button type="button" onClick={copyLink} className={OUTLINED_PILL}>
          {copied === "yes" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
          {copied === "yes" ? copy.copied : copy.copy}
        </button>
        {/* Outlined like Copy link: the one orange button is the way on (owner's pick D3). */}
        {shareHref && (
          <a href={shareHref} target="_blank" rel="noopener noreferrer" className={OUTLINED_PILL}>
            <MessageCircle className="size-5" aria-hidden />
            {copy.share}
          </a>
        )}
        <p aria-live="polite" className={cn("text-sm text-red-600", copied !== "failed" && "sr-only")}>
          {copied === "failed" ? copy.copyFailed : copied === "yes" ? copy.copied : ""}
        </p>
      </div>

      {done.status === "registered" ? (
        <>
          <Note tone="wait">{copy.confirmNote}</Note>
          <Note tone="info">
            <span className="wrap-anywhere">{copy.emailNote(done.email)}</span>
          </Note>
        </>
      ) : (
        <Note tone="info">{copy.claimDoneNote}</Note>
      )}

      <Link
        href="/home"
        className={cn(buttonVariants({ variant: "orange" }), "h-auto min-h-13 w-full justify-between gap-3 rounded-full py-2.5 pr-4 pl-6 text-left font-exo text-lg whitespace-normal italic shadow-md shadow-orange-500/20")}
      >
        {copy.seeStudents}
        <ChevronRight className="size-5" aria-hidden />
      </Link>

      <div className="flex flex-col items-center">
        <p className="text-sm text-slate-600">{copy.call}</p>
        <a
          href={`tel:${officePhone.replaceAll(" ", "")}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
        >
          <Phone className="size-5" strokeWidth={2} aria-hidden />
          {officePhone}
        </a>
      </div>
    </section>
  )
}
