"use client"

import { Check, ChevronDown, Copy, MessageCircle, Phone, Plus } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react"

import { BrandTopBar } from "@/components/brand"
import {
  ChangeLink,
  ChoiceTiles,
  Confetti,
  ContinuePill,
  FieldError,
  FieldInput,
  GuidedNote,
  GuidedStack,
  GuidedStep,
  Hint,
  NoticeBox,
  ProgressBar,
  QuestionTitle,
  revealStep,
  SummaryRow,
} from "@/components/guided-form"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import { buttonVariants } from "@/components/ui/button"
import { agentRegistrationProblem, type AgentDraft, type AgentField } from "@/lib/agent-registration"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { CARD } from "./frame"
import { registerAsAgent } from "./actions"
import { COPY } from "./copy"
import type { DiscountCodeMessage, DiscountCodeState } from "./outcome"

// The Discount code page's form and its confirmation, in concept C: one
// question at a time, answered ones folding into a line with a two-word
// "Badilisha …" link. The entries live in this component's state, so the
// menu's language switch (which re-renders the page around it) or a refused
// send never loses one. "Tayari una code?" claims an existing code (#193):
// Ndiyo makes the code required, Hapana leaves it optional.

const EMPTY: AgentDraft = { fullName: "", phone: "", whatsapp: "", email: "", hasCode: false, code: "" }

type Copy = (typeof COPY)[Language]
type Done = Extract<DiscountCodeState, { status: "registered" | "claimed" }>
// A problem shown under its field. `server` marks a phone or code the
// database couldn't read, which reads differently from an empty one.
type Shown = { field: AgentField; server: boolean }
type Notice = "check-pending" | DiscountCodeMessage | null
type Step = "name" | "phone" | "email" | "code" | "send"
type CodeAnswer = "yes" | "no" | null

const ORDER: Step[] = ["name", "phone", "email", "code", "send"]
// The step each field is asked on. The draft is checked in this same order
// (lib/agent-registration.ts), so the first problem names the earliest step.
const FIELD_STEP: Record<AgentField, Step> = { full_name: "name", phone: "phone", whatsapp: "phone", email: "email", code: "code" }

// Answers that aren't a problem with the form: shown calmly.
const CALM = new Set<Notice>(["claim-waiting", "invited", "joined"])

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
}: {
  language: Language
  officePhone: string
  discount?: number | null
  showLanguagePrompt?: boolean
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
  const [sending, startSending] = useTransition()
  // Counts restarts, so an answer to a send from before "Futa fomu yote" is ignored.
  const round = useRef(0)
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const form = useRef<HTMLFormElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // What gets checked and sent: WhatsApp only while its field is shown.
  const entries: AgentDraft = { ...draft, whatsapp: whatsappOn ? draft.whatsapp : "", hasCode: codeAnswer === "yes" }

  // After a problem or a send, put the reader at the field to fix, or at the
  // confirmation. Runs after the step's own focus, so it wins.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const target = problem ? document.querySelector<HTMLElement>(`[data-field="${problem.field}"]`) : heading.current
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
    const found = agentRegistrationProblem(entries)
    if (!found) return null
    return ORDER.indexOf(FIELD_STEP[found]) <= ORDER.indexOf(step) ? found : null
  }

  function next(step: Step) {
    const found = problemUpTo(step)
    if (found) return show({ field: found, server: false })
    const now = new Set(answered).add(step)
    setAnswered(now)
    setProblem(null)
    setOpen(ORDER.find((k) => !now.has(k)) ?? "send")
  }

  function openStep(step: Step) {
    if (step === open) return
    // Leaving an answered step half-fixed would fold a wrong answer away.
    if (open !== "send" && answered.has(open)) {
      const found = problemUpTo(open)
      if (found) return show({ field: found, server: false })
    }
    setProblem(null)
    setOpen(step)
  }

  function startOver() {
    // A send still in flight belongs to the form being cleared; its answer is ignored.
    round.current += 1
    setDraft(EMPTY)
    setWhatsappOn(false)
    setCodeAnswer(null)
    setAnswered(new Set())
    setOpen("name")
    setProblem(null)
    setNotice(null)
    setDone(null)
    // A full restart skips the fold animations, for that one render.
    setInstant(true)
    window.setTimeout(() => setInstant(false), 0)
  }

  function onSend() {
    if (sending || !form.current) return
    const found = agentRegistrationProblem(entries)
    if (found) return show({ field: found, server: false })

    const data = new FormData(form.current)
    // Turnstile fills its token in a moment after the step opens; sending
    // before then would only be refused.
    if (!data.get("cf-turnstile-response")) {
      // A check that needs a click says so itself, next to Send.
      setNotice(turnstile.current?.reveal() ? null : "check-pending")
      return
    }
    data.set("full_name", entries.fullName)
    data.set("phone", entries.phone)
    data.set("whatsapp", entries.whatsapp)
    data.set("email", entries.email)
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
        moved.current = true
        setDone(result)
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      turnstile.current?.reset()
      if (result.status === "invalid") return show({ field: result.field, server: true })
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  const topBar = (
    <BrandTopBar variant="complex" language={language} showLanguagePrompt={showLanguagePrompt} onClearForm={startOver} />
  )

  if (done) {
    return (
      <>
        {topBar}
        <Confirmation copy={copy} done={done} officePhone={officePhone} headingRef={heading} />
      </>
    )
  }

  const message = (field: AgentField) => {
    if (problem?.field !== field) return undefined
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    if (problem.server && field === "code") return copy.problems.code_unreadable
    return copy.problems[field]
  }

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

  const visible = (step: Step) => answered.has(step) || open === step
  const stateOf = (step: Step) => (open === step ? "open" : "folded")
  const change = (step: Step, label: string) => <ChangeLink onClick={() => openStep(step)}>{label}</ChangeLink>
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined

  // Wewe: name (1), then phone and WhatsApp together (2 and 3). Code: email, then the code.
  const youDone = (answered.has("name") ? 1 : 0) + (answered.has("phone") ? 2 : 0)
  const codeDone = (answered.has("email") ? 1 : 0) + (answered.has("code") ? 1 : 0)
  const activeGroup = open === "name" || open === "phone" ? 0 : open === "send" ? 2 : 1
  const position = { name: 1, phone: 2, email: 1, code: 2, send: 0 }[open]
  const status =
    open === "send"
      ? copy.progressDone
      : activeGroup === 0
        ? copy.progress(copy.groups.you, position, 3)
        : copy.progress(copy.groups.code, position, 2)
  const nothingYet = answered.size === 0 && Object.values(draft).every((v) => v === "" || v === false)

  return (
    <>
      {topBar}
      <h1 className="sr-only">{copy.title}</h1>
      <section className={CARD}>
        <ProgressBar
          groups={[
            { label: copy.groups.you, steps: 3, done: youDone, current: activeGroup === 0 ? position - 1 : undefined },
            { label: copy.groups.code, steps: 2, done: codeDone, current: activeGroup === 1 ? position - 1 : undefined },
          ]}
          activeGroup={activeGroup}
          canBack={open !== "name"}
          onBack={() => openStep(ORDER[ORDER.indexOf(open) - 1])}
          canReset={open === "name" && !nothingYet}
          onReset={startOver}
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
            else next(open)
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
                summary={answered.has("name") && <SummaryRow label={copy.fullName} value={draft.fullName.trim()} action={change("name", copy.change.name)} />}
              >
                <QuestionTitle htmlFor="full-name">{copy.nameQuestion}</QuestionTitle>
                <div>
                  <FieldInput
                    id="full-name"
                    name="full_name"
                    data-field="full_name"
                    value={draft.fullName}
                    onChange={(event) => update({ fullName: event.target.value })}
                    onKeyDown={onEnter("name")}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    maxLength={200}
                    invalid={!!message("full_name")}
                    aria-describedby={describedBy(!!message("full_name") && "full-name-error")}
                  />
                  <FieldError id="full-name-error" message={message("full_name")} />
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
                      label={copy.phone}
                      value={
                        <>
                          {draft.phone.trim()}
                          {entries.whatsapp.trim() && (
                            <>
                              <br />
                              <span className="text-sm font-normal text-slate-600">WhatsApp {entries.whatsapp.trim()}</span>
                            </>
                          )}
                        </>
                      }
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
                summary={answered.has("email") && <SummaryRow label={copy.email} value={<span className="wrap-anywhere">{draft.email.trim()}</span>} action={change("email", copy.change.email)} />}
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

            {visible("code") && (
              <GuidedStep
                key="code"
                state={stateOf("code")}
                onOpened={focusFirstField}
                openOnMount
                summary={
                  answered.has("code") && (
                    <SummaryRow
                      label={copy.hasCode}
                      value={entries.code.trim() ? `${codeAnswer === "yes" ? copy.yes : copy.no} · ${entries.code.trim()}` : copy.no}
                      action={change("code", copy.change.code)}
                    />
                  )
                }
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
                  onChange={(value) => {
                    setCodeAnswer(value as CodeAnswer)
                    setProblem(null)
                  }}
                  describedBy="has-code-hint"
                >
                  <Hint id="has-code-hint" className="text-center">
                    {copy.hasCodeHint}
                  </Hint>
                </ChoiceTiles>
                {codeAnswer && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="code" className="text-[15px] font-semibold text-slate-800">
                        {copy.code}
                        {codeAnswer === "no" && <span className="font-normal text-slate-500"> ({copy.optional})</span>}
                      </label>
                      <Hint id="code-hint">{copy.codeHint}</Hint>
                      <FieldInput
                        id="code"
                        name="code"
                        data-field="code"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        enterKeyHint="next"
                        value={draft.code}
                        onChange={(event) => update({ code: event.target.value })}
                        onKeyDown={onEnter("code")}
                        maxLength={200}
                        invalid={!!message("code")}
                        aria-describedby={describedBy("code-hint", !!message("code") && "code-error")}
                      />
                      <FieldError id="code-error" message={message("code")} />
                    </div>
                    <ContinuePill onClick={() => next("code")}>{copy.next}</ContinuePill>
                  </>
                )}
              </GuidedStep>
            )}

            {open === "send" && (
              <GuidedStep key="send" state="open" onOpened={focusFirstField} openOnMount>
                <QuestionTitle>{copy.reviewQuestion}</QuestionTitle>
                <Hint className="-mt-2">{copy.reviewHint}</Hint>
                {notice && (
                  <NoticeBox tone={CALM.has(notice) ? "info" : "bad"} role="alert">
                    {noticeText(copy, notice)}
                    {notice === "joined" && (
                      <>
                        {" "}
                        <Link href="/login" className="font-semibold underline underline-offset-4">
                          {copy.signIn}
                        </Link>
                      </>
                    )}
                  </NoticeBox>
                )}
                {/* Inside the form, so its token is sent; invisible unless Cloudflare
                    needs a click, and then right above Send. */}
                <TurnstileWidget ref={turnstile} action="agent" language={language} />
                <ContinuePill type="submit" pending={sending} disabled={sending}>
                  {sending ? copy.sending : copy.send}
                </ContinuePill>
              </GuidedStep>
            )}
          </GuidedStack>
        </form>

        {/* Kept apart from "Tayari una code?": this one is for someone who
            has already set a password. */}
        <p className="mt-6 text-center text-sm text-slate-600">
          {copy.signInPrompt}{" "}
          <Link
            href="/login"
            className="font-semibold text-blue-600 underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            {copy.signIn}
          </Link>
        </p>
      </section>
    </>
  )
}

const OUTLINED_PILL =
  "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.97]"

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
  const tick = useRef<HTMLDivElement>(null)
  const shareHref = discountCodeShareLink(copy.shareText(done.code, done.link))

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
      <Confetti originRef={tick} />
      <div
        ref={tick}
        className="grid size-[84px] place-items-center rounded-full bg-orange-500 text-white shadow-[0_10px_30px_-8px_rgb(238_115_0/0.6)] motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:duration-500"
      >
        <Check className="size-11" strokeWidth={3} aria-hidden />
      </div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic outline-none"
      >
        {copy.doneTitle}
      </h1>
      <p className="w-full max-w-full rounded-full bg-blue-50 px-4 py-3 font-mono text-[2.5rem] leading-tight font-bold tracking-wide wrap-anywhere text-blue-600 ring-1 ring-blue-600/15 max-[330px]:text-[2rem]">
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
        {shareHref && (
          <a
            href={shareHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "orange" }), "min-h-13 rounded-full px-6 font-exo text-lg italic shadow-md shadow-orange-500/20")}
          >
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
        <Note tone="info">{copy.claimNote}</Note>
      )}

      <div className="flex flex-col items-center">
        <p className="text-sm text-slate-600">{copy.call}</p>
        <a
          href={`tel:${officePhone.replaceAll(" ", "")}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
        >
          <Phone className="size-5" strokeWidth={2} aria-hidden />
          {officePhone}
        </a>
      </div>
    </section>
  )
}
