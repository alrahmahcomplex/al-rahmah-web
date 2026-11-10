"use client"

import { CalendarDays, ChevronDown, MessageCircle, Phone, Plus, Tag, User } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

import {
  ChangeLink,
  ChoiceTiles,
  ContinuePill,
  DefaultTile,
  FieldError,
  FieldInput,
  GuidedHead,
  GuidedNote,
  GuidedStep,
  Hint,
  InfoButton,
  NoticeBox,
  OfferNote,
  OfferPill,
  PriceAnchor,
  QuestionTitle,
  SummaryRow,
} from "@/components/guided-form"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { FormField } from "@/lib/admission-form"
import type { Language } from "@/lib/language"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { FORM_NOTICE, FORM_NOTICE_VERSION } from "@/lib/referral-notice"
import { DAY_OR_BOARDING, RELATIONSHIPS, type DayOrBoarding, type Relationship } from "@/lib/services/leads"

import type { ChangeWord, FormCopy } from "./copy"
import type { ChildDraft, ParentDraft } from "./draft"
import { firstName, parseKey, STUDENT_KINDS, studentKey, yearOf, type StepKey } from "./flow"
import type { DiscountCodeCheck } from "./outcome"

// The Admission form's stack: group titles, one question open at a time, and
// a folded line for every answered one. The form (./admission-form.tsx) owns
// the state and hands it in; this file only draws it.

export const POPULAR_CLASS = "FORM 1"

/** "TZS 50,000", the way the school writes amounts. */
export function tzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

export function stepId(key: StepKey): string {
  return `step-${key.replace(":", "-")}`
}

export type QuestionsProps = {
  copy: FormCopy
  language: Language
  years: readonly [number, number]
  defaultYear: number
  parent: ParentDraft
  children: readonly ChildDraft[]
  discountCode: string
  done: ReadonlySet<StepKey>
  open: StepKey
  // Open the question's body with focus when it appears after a tap, but not
  // on the first paint.
  focusOnMount: boolean
  expanded: ReadonlySet<number>
  yearOpen: ReadonlySet<number>
  whatsappOn: boolean
  /** The problem to show under a field, or null. */
  message: (field: FormField, child?: number | null) => string | null
  codeAnswer: DiscountCodeCheck | null
  codeChecking: boolean
  feeEach: number
  discountEach: number
  liveDiscount: number | null
  notice: string | null
  formProblem: { field: FormField; text: string } | null
  sending: boolean
  turnstileRef: React.RefObject<TurnstileWidgetHandle | null>
  onOpened: (li: HTMLLIElement) => void
  on: {
    commit: (key: StepKey) => void
    change: (key: StepKey) => void
    child: (card: number, change: Partial<Omit<ChildDraft, "card">>, commitAfter?: boolean) => void
    parent: (change: Partial<ParentDraft>) => void
    // A tap on a choice answers the question, even on the one already picked.
    tapChoice: (key: StepKey, event: React.MouseEvent) => void
    code: (value: string) => void
    codeBlur: () => void
    codeCheck: () => void
    classSheet: (card: number) => void
    toggleYear: (card: number) => void
    addStudent: () => void
    removeStudent: (card: number) => void
    expand: (card: number) => void
    toggleWhatsapp: () => void
    offer: () => void
  }
}

export function questionItems(p: QuestionsProps): ReactElement[] {
  const { copy, children, done, open } = p
  const visible = (key: StepKey) => done.has(key) || open === key
  const n = children.length
  const items: ReactElement[] = []

  if ((children[0] && done.has(studentKey("name", children[0].card))) || n > 1) {
    items.push(<GuidedHead key="h:students">{n === 1 ? copy.oneStudent : copy.sections[0]}</GuidedHead>)
  }
  children.forEach((child, index) => {
    const keys = STUDENT_KINDS.map((kind) => studentKey(kind, child.card))
    if (!keys.some(visible)) return
    const complete = keys.every((key) => done.has(key))
    const compact = complete && !keys.includes(open) && !p.expanded.has(child.card) && !(index === n - 1 && open === "more")
    const label = firstName(child.fullName) || copy.student(index + 1)
    if (compact) {
      items.push(
        <GuidedNote key={`cs:${child.card}`}>
          <SummaryRow
            icon={<User className="size-4" aria-hidden />}
            value={
              <>
                {child.fullName.trim()}{" "}
                <span className="font-normal text-slate-500">
                  · {child.className} · {yearOf(children, index, p.defaultYear)} · {copy.dayOrBoarding[child.dayOrBoarding as DayOrBoarding]}
                </span>
              </>
            }
            action={
              <ChangeLink aria-expanded={false} aria-label={`${copy.change.kid}, ${child.fullName.trim()}`} onClick={() => p.on.expand(child.card)}>
                {copy.change.kid}
              </ChangeLink>
            }
          />
        </GuidedNote>,
      )
      return
    }
    if (n > 1) {
      items.push(
        <GuidedNote key={`h:${child.card}`}>
          <div className="flex items-center gap-2">
            <h3 id={`kh-${child.card}`} tabIndex={-1} className="m-0 min-w-0 text-[15px] font-semibold text-slate-800 [overflow-wrap:anywhere] outline-none">
              {label}
            </h3>
            <ChangeLink className="ml-auto text-slate-600" aria-label={copy.removeNamed(child.fullName.trim() || copy.student(index + 1))} onClick={() => p.on.removeStudent(child.card)}>
              {copy.removeStudent}
            </ChangeLink>
          </div>
        </GuidedNote>,
      )
    }
    keys.filter(visible).forEach((key) => items.push(step(p, key)))
  })
  if (visible("more")) items.push(step(p, "more"))
  if (n >= 8 && done.has(studentKey("board", children[n - 1].card))) {
    items.push(
      <GuidedNote key="max">
        <NoticeBox tone="info">{copy.maxChildren(8)}</NoticeBox>
      </GuidedNote>,
    )
  }
  if (visible("pname")) items.push(<GuidedHead key="h:parent">{copy.parentBlock}</GuidedHead>)
  for (const key of ["pname", "rel", "phone"] as const) if (visible(key)) items.push(step(p, key))
  if (visible("code")) items.push(<GuidedHead key="h:interview">{copy.sections[2]}</GuidedHead>)
  for (const key of ["code", "fee", "send"] as const) if (visible(key)) items.push(step(p, key))
  return items
}

function step(p: QuestionsProps, key: StepKey): ReactElement {
  return (
    <GuidedStep
      key={key}
      id={stepId(key)}
      state={p.open === key ? "open" : "folded"}
      summary={p.done.has(key) ? summary(p, key) : undefined}
      onOpened={p.onOpened}
      openOnMount={p.focusOnMount}
    >
      {body(p, key)}
    </GuidedStep>
  )
}

function changeLink(p: QuestionsProps, key: StepKey, word: ChangeWord) {
  const { card } = parseKey(key)
  const index = p.children.findIndex((child) => child.card === card)
  const who = index >= 0 && p.children.length > 1 ? firstName(p.children[index].fullName) || p.copy.student(index + 1) : null
  return (
    <ChangeLink aria-label={who ? `${p.copy.change[word]}, ${who}` : undefined} onClick={() => p.on.change(key)}>
      {p.copy.change[word]}
    </ChangeLink>
  )
}

function summary(p: QuestionsProps, key: StepKey): ReactNode {
  const { copy, parent } = p
  const { kind, card } = parseKey(key)
  const index = p.children.findIndex((child) => child.card === card)
  const child = p.children[index]
  switch (kind) {
    case "name":
      return <SummaryRow label={copy.studentName} value={child.fullName.trim()} action={changeLink(p, key, "name")} />
    case "class":
      return <SummaryRow label={copy.className} value={`${child.className} · ${yearOf(p.children, index, p.defaultYear)}`} action={changeLink(p, key, "class")} />
    case "board":
      return <SummaryRow label={copy.boardingName} value={copy.dayOrBoarding[child.dayOrBoarding as DayOrBoarding]} action={changeLink(p, key, "board")} />
    case "more":
      return (
        <SummaryRow
          value={copy.noMore}
          action={
            <ChangeLink onClick={p.on.addStudent}>
              <Plus className="size-4" aria-hidden />
              {copy.addStudent}
            </ChangeLink>
          }
        />
      )
    case "pname":
      return <SummaryRow label={copy.parentName} value={parent.fullName.trim()} action={changeLink(p, key, "pname")} />
    case "rel":
      return (
        <SummaryRow
          label={copy.relName}
          value={parent.relationship === "Other" ? `${copy.relationships.Other}: ${parent.relationshipDescription.trim()}` : copy.relationships[parent.relationship as Relationship]}
          action={changeLink(p, key, "rel")}
        />
      )
    case "phone":
      return (
        <SummaryRow
          label={copy.phone}
          value={
            <>
              {parent.phone.trim()}
              {parent.whatsapp.trim() && (
                <span className="block text-sm font-normal text-slate-500">WhatsApp {parent.whatsapp.trim()}</span>
              )}
            </>
          }
          action={changeLink(p, key, "phone")}
        />
      )
    case "code": {
      const code = p.discountCode.trim().toUpperCase()
      const status = p.codeAnswer && "amount" in p.codeAnswer ? p.codeAnswer.status : null
      return (
        <SummaryRow
          label={copy.codeLabel}
          value={
            code ? (
              <>
                {code}
                {status && <span className="font-normal text-slate-500"> · {copy.codeStatus[status]}</span>}
              </>
            ) : (
              copy.codeNone
            )
          }
          action={changeLink(p, key, "code")}
        />
      )
    }
    case "fee":
      return (
        <SummaryRow
          label={copy.feeQ}
          value={
            <>
              {tzs(p.feeEach * p.children.length)} <span className="font-normal text-slate-500">· {copy.feeStudents(p.children.length)}</span>
            </>
          }
          action={p.discountEach > 0 ? <OfferPill onClick={p.on.offer}>{copy.offerPill}</OfferPill> : undefined}
        />
      )
  }
  return null
}

function body(p: QuestionsProps, key: StepKey): ReactNode {
  const { copy, children, parent } = p
  const { kind, card } = parseKey(key)
  const index = children.findIndex((child) => child.card === card)
  const child = children[index]
  const next = (label = copy.continue) => <ContinuePill onClick={() => p.on.commit(key)}>{label}</ContinuePill>
  const titleId = `q-${stepId(key)}`

  switch (kind) {
    case "name": {
      const id = `student-name-${child.card}`
      const error = p.message("student_name", index) ?? p.message("duplicate_child", index)
      return (
        <>
          <QuestionTitle id={titleId} htmlFor={id}>
            {copy.studentNameQ(index + 1)}
          </QuestionTitle>
          <div className="flex flex-col gap-2">
            <Hint id={`h-${id}`}>{copy.studentNameHint}</Hint>
            <FieldInput
              id={id}
              data-field="student_name"
              value={child.fullName}
              maxLength={200}
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="next"
              invalid={Boolean(error)}
              aria-describedby={`h-${id} e-${id}`}
              onChange={(event) => p.on.child(child.card, { fullName: event.target.value })}
            />
            <FieldError id={`e-${id}`} message={error} />
          </div>
          {next()}
        </>
      )
    }
    case "class": {
      const year = yearOf(children, index, p.defaultYear)
      const joining = copy.joining(year)
      const error = p.message("class_name", index) ?? p.message("enrollment_year", index)
      const yearsId = `years-${child.card}`
      return (
        <div role="group" aria-labelledby={titleId} className="flex flex-col gap-4">
          <QuestionTitle id={titleId}>{copy.classQ(firstName(child.fullName))}</QuestionTitle>
          <div className="flex items-center gap-2.5 rounded-[18px] bg-blue-50 py-2.5 pr-2.5 pl-4 text-left text-[15px] text-blue-950 max-[380px]:flex-wrap max-[380px]:justify-center">
            <CalendarDays className="size-5 flex-none text-blue-600" aria-hidden />
            <span id={`yl-${child.card}`} className="min-w-0">
              {joining.before} <strong className="font-bold">{joining.year}</strong>
            </span>
            <ChangeLink className="ml-auto max-[380px]:ml-0" aria-expanded={p.yearOpen.has(child.card)} aria-controls={yearsId} aria-describedby={`yl-${child.card}`} onClick={() => p.on.toggleYear(child.card)}>
              {copy.change.year}
            </ChangeLink>
          </div>
          {p.yearOpen.has(child.card) && (
            <div id={yearsId}>
              <ChoiceTiles
                name={`year-${child.card}`}
                legend={<span className="sr-only">{copy.yearName}</span>}
                layout="two"
                options={p.years.map((y, j) => ({ value: String(y), label: `${y} · ${j === 0 ? copy.thisYear : copy.nextYear}` }))}
                value={String(year)}
                onChange={(value) => p.on.child(child.card, { enrollmentYear: Number(value) })}
              />
            </div>
          )}
          <DefaultTile
            label={POPULAR_CLASS}
            tagline={copy.popular}
            pressed={child.className === POPULAR_CLASS}
            describedBy={`e-class-${child.card}`}
            onClick={() => p.on.child(child.card, { className: POPULAR_CLASS }, true)}
          />
          {child.className && child.className !== POPULAR_CLASS && (
            <DefaultTile label={child.className} pressed onClick={() => p.on.child(child.card, { className: child.className }, true)} />
          )}
          <ContinuePill variant="ghost" aria-haspopup="dialog" onClick={() => p.on.classSheet(child.card)}>
            {copy.chooseOther}
          </ContinuePill>
          <FieldError id={`e-class-${child.card}`} message={error} />
          {p.done.has(key) && next()}
        </div>
      )
    }
    case "board": {
      const before = index > 0 ? children[index - 1] : null
      const picked = child.dayOrBoarding || before?.dayOrBoarding || ""
      const fromBefore = !child.dayOrBoarding && Boolean(before?.dayOrBoarding)
      const error = p.message("day_or_boarding", index)
      return (
        <>
          <div onClick={(event) => p.on.tapChoice(key, event)}>
          <ChoiceTiles
            name={`board-${child.card}`}
            legend={<QuestionTitle id={titleId}>{copy.boardingQ(firstName(child.fullName))}</QuestionTitle>}
            options={DAY_OR_BOARDING.map((value) => ({
              value,
              label: copy.dayOrBoarding[value],
              description: fromBefore && picked === value && before ? copy.sameAs(firstName(before.fullName)) : copy.dayOrBoardingHint[value],
            }))}
            value={picked || null}
            describedBy={`e-board-${child.card}`}
            onChange={(value) => p.on.child(child.card, { dayOrBoarding: value })}
          >
            <FieldError id={`e-board-${child.card}`} message={error} />
          </ChoiceTiles>
          </div>
          {next()}
        </>
      )
    }
    case "more":
      return (
        <>
          <QuestionTitle id={titleId}>{copy.anotherQ}</QuestionTitle>
          <ContinuePill variant="ghost" icon="plus" onClick={p.on.addStudent}>
            {copy.anotherYes}
          </ContinuePill>
          <ContinuePill className="mt-2.5" onClick={() => p.on.commit("more")}>
            {copy.anotherNo}
          </ContinuePill>
        </>
      )
    case "pname": {
      const error = p.message("contact_name")
      return (
        <>
          <QuestionTitle id={titleId} htmlFor="parent-name">
            {copy.parentNameQ}
          </QuestionTitle>
          <div className="flex flex-col gap-2">
            <FieldInput
              id="parent-name"
              data-field="contact_name"
              value={parent.fullName}
              maxLength={200}
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              invalid={Boolean(error)}
              aria-describedby="e-parent-name"
              onChange={(event) => p.on.parent({ fullName: event.target.value })}
            />
            <FieldError id="e-parent-name" message={error} />
          </div>
          {next()}
        </>
      )
    }
    case "rel": {
      const error = p.message("relationship") ?? p.message("relationship_description")
      const one = children.length === 1 ? firstName(children[0].fullName) : null
      return (
        <>
          <div onClick={(event) => p.on.tapChoice(key, event)}>
          <ChoiceTiles
            name="relationship"
            legend={<QuestionTitle id={titleId}>{children.length > 1 ? copy.relQMany : copy.relQ(one)}</QuestionTitle>}
            layout="four"
            options={RELATIONSHIPS.map((value) => ({ value, label: copy.relationships[value] }))}
            value={parent.relationship || null}
            describedBy="e-relationship"
            onChange={(value) => p.on.parent({ relationship: value })}
          >
            {parent.relationship === "Other" && (
              <div className="mt-1.5 flex flex-col gap-2 text-left">
                <label htmlFor="relationship-description" className="text-[15px] font-semibold text-slate-800">
                  {copy.relDescribe}
                </label>
                <FieldInput
                  id="relationship-description"
                  data-field="relationship_description"
                  value={parent.relationshipDescription}
                  maxLength={200}
                  enterKeyHint="next"
                  invalid={Boolean(p.message("relationship_description"))}
                  aria-describedby="e-relationship"
                  onChange={(event) => p.on.parent({ relationshipDescription: event.target.value })}
                />
              </div>
            )}
            <FieldError id="e-relationship" message={error} />
          </ChoiceTiles>
          </div>
          {next()}
        </>
      )
    }
    case "phone": {
      const phoneError = p.message("phone")
      const whatsappError = p.message("whatsapp")
      return (
        <>
          <QuestionTitle id={titleId} htmlFor="phone">
            {copy.phoneQ}
          </QuestionTitle>
          <div className="flex flex-col gap-2">
            <Hint id="h-phone">{copy.phoneHint}</Hint>
            <FieldInput
              id="phone"
              data-field="phone"
              type="tel"
              inputMode="tel"
              value={parent.phone}
              maxLength={200}
              autoComplete="tel"
              placeholder="0712 345 678"
              enterKeyHint="next"
              icon={<Phone className="size-5" aria-hidden />}
              invalid={Boolean(phoneError)}
              aria-describedby="h-phone e-phone"
              onChange={(event) => p.on.parent({ phone: event.target.value })}
            />
            <FieldError id="e-phone" message={phoneError} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <ChangeLink aria-expanded={p.whatsappOn} aria-controls="whatsapp-field" onClick={p.on.toggleWhatsapp}>
              {p.whatsappOn ? <ChevronDown className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {copy.whatsappDifferent}
            </ChangeLink>
            {p.whatsappOn && (
              <div id="whatsapp-field" className="flex w-full flex-col gap-2 text-left">
                <label htmlFor="whatsapp" className="text-[15px] font-semibold text-slate-800">
                  {copy.whatsapp} <span className="font-normal text-slate-500">({copy.optional})</span>
                </label>
                <FieldInput
                  id="whatsapp"
                  data-field="whatsapp"
                  type="tel"
                  inputMode="tel"
                  value={parent.whatsapp}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="0712 345 678"
                  icon={<MessageCircle className="size-5" aria-hidden />}
                  invalid={Boolean(whatsappError)}
                  aria-describedby="e-whatsapp"
                  onChange={(event) => p.on.parent({ whatsapp: event.target.value })}
                />
                <FieldError id="e-whatsapp" message={whatsappError} />
              </div>
            )}
          </div>
          {next()}
        </>
      )
    }
    case "code":
      return codeBody(p, next, titleId)
    case "fee": {
      const discounted = p.feeEach < STANDARD_INTERVIEW_FEE
      return (
        <>
          <QuestionTitle id={titleId}>{copy.feeQ}</QuestionTitle>
          <div className="text-left">
            <ul className="m-0 mt-1.5 mb-2.5 list-none p-0 tabular-nums">
              {children.map((c) => (
                <li key={c.card} className="flex justify-between gap-3 border-b border-blue-100 py-2 text-[15px]">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.fullName.trim()}</span>
                  <span className="flex-none font-semibold whitespace-nowrap">
                    {discounted && (
                      <>
                        <s className="mr-1.5 font-normal text-slate-500">{STANDARD_INTERVIEW_FEE.toLocaleString("en-US")}</s>
                        <InfoButton label={copy.offerInfo} onClick={p.on.offer} />
                      </>
                    )}
                    {tzs(p.feeEach)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 rounded-[18px] bg-[#fff4ec] px-4 py-3.5 text-[#6b2a00] tabular-nums">
              <span className="text-sm font-semibold">{copy.feeTotal}</span>
              <span className="text-right text-[17px] font-bold">{tzs(p.feeEach * children.length)}</span>
            </div>
            {p.discountEach > 0 && (
              <p className="m-0 mt-2 text-center text-sm font-semibold text-[#0f7a3d]">{copy.savedTotal(tzs(p.discountEach * children.length))}</p>
            )}
            <Hint className="mt-2 text-center">{copy.feeWhen}</Hint>
          </div>
          {next()}
        </>
      )
    }
    case "send":
      return (
        <>
          <QuestionTitle id={titleId}>{copy.reviewQ}</QuestionTitle>
          <p className="m-0 -mt-2 text-[15px] text-slate-600">{copy.reviewSub}</p>
          {/* The form records FORM_NOTICE_VERSION with any code it sends, so the
              notice is on screen here too: a restored draft or a Referral link
              can carry a code past a Discount code question the parent never
              opened. */}
          {p.discountCode.trim() !== "" && (
            <NoticeBox tone="info" icon={<Tag className="mt-px size-4 flex-none" aria-hidden />}>
              <span data-notice-version={FORM_NOTICE_VERSION}>{FORM_NOTICE[p.language]}</span>
            </NoticeBox>
          )}
          {(p.notice || p.formProblem) && (
            <NoticeBox tone="bad" role="alert" className="outline-none">
              <span tabIndex={-1} data-form-problem={p.formProblem?.field} className="outline-none">
                {p.notice ?? p.formProblem?.text}
              </span>
            </NoticeBox>
          )}
          {/* Inside the form, so its token is sent; invisible unless Cloudflare
              needs a click, and then right above Send. */}
          <TurnstileWidget ref={p.turnstileRef} action="admission" language={p.language} />
          <ContinuePill type="submit" pending={p.sending}>
            {p.sending ? copy.sending : copy.send}
          </ContinuePill>
        </>
      )
  }
  return null
}

function codeBody(p: QuestionsProps, next: (label?: string) => ReactElement, titleId: string) {
  const { copy, codeAnswer: answer } = p
  const error = p.message("discount_code")
  const filled = p.discountCode.trim() !== ""
  const notes: ReactNode[] = []
  if (filled && !error) {
    if (p.codeChecking) {
      notes.push(
        <NoticeBox key="checking" tone="info" icon={<span className="gf-btn-spin mt-0.5 size-3.5 flex-none" aria-hidden="true" />}>
          {copy.codeChecking}
        </NoticeBox>,
      )
    } else if (answer) {
      // The code's own amount, which a Promo code or an agent may set: the
      // standard fee less the fee this code leaves. A confirmed code set to
      // nothing off reads like one that gives no discount for now.
      const saving = answer.status === "approved" ? STANDARD_INTERVIEW_FEE - answer.amount : 0
      const status =
        answer.status === "rate-limited" || answer.status === "unavailable"
          ? "unchecked"
          : answer.status === "approved" && saving <= 0
            ? "switched_off"
            : answer.status
      const tone = { approved: "good", pending: "wait", switched_off: "info", unknown: "bad", unchecked: "info" } as const
      notes.push(
        <NoticeBox key="status" tone={tone[status]}>
          {status === "approved" ? copy.discountNotes.approved(tzs(saving)) : copy.discountNotes[status]}
        </NoticeBox>,
      )
      if (status === "approved") {
        notes.push(
          <OfferNote key="offer" pulse title={copy.offerTitle}>
            {copy.offerBody(p.children.length)}
          </OfferNote>,
        )
      }
    }
  }
  const saving = p.liveDiscount
  return (
    <>
      <QuestionTitle id={titleId}>{copy.haveCode}</QuestionTitle>
      <PriceAnchor
        fullLabel={copy.anchorWithout}
        fullAmount={tzs(STANDARD_INTERVIEW_FEE)}
        codeLabel={copy.anchorWith}
        saving={saving ? copy.anchorSave(tzs(saving)) : undefined}
        was={saving ? { from: STANDARD_INTERVIEW_FEE.toLocaleString("en-US"), to: (STANDARD_INTERVIEW_FEE - saving).toLocaleString("en-US") } : undefined}
      />
      <Hint className="-mt-1">{copy.codeHint}</Hint>
      <div className="flex flex-col gap-2 text-left">
        <label htmlFor="discount-code" className="text-[15px] font-semibold text-slate-800">
          {copy.codeLabel} <span className="font-normal text-slate-500">({copy.optional})</span>
        </label>
        <div className="flex gap-2 max-[380px]:flex-wrap">
          <FieldInput
            id="discount-code"
            data-field="discount_code"
            className="min-w-0 flex-1 uppercase"
            value={p.discountCode}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="done"
            invalid={Boolean(error)}
            aria-describedby={`e-discount-code code-notes${filled ? " discount-code-holder-notice" : ""}`}
            onChange={(event) => p.on.code(event.target.value)}
            onBlur={p.on.codeBlur}
          />
          <ContinuePill variant="ghost" className="min-h-13 w-auto flex-none rounded-full px-[18px] text-base max-[380px]:w-full" onClick={p.on.codeCheck}>
            {copy.codeCheck}
          </ContinuePill>
        </div>
        <FieldError id="e-discount-code" message={error} />
        <div id="code-notes" aria-live="polite" className="flex flex-col gap-2.5 empty:hidden">
          {notes}
        </div>
        {filled && (
          <NoticeBox tone="info" icon={<Tag className="mt-px size-4 flex-none" aria-hidden />}>
            <span id="discount-code-holder-notice" data-notice-version={FORM_NOTICE_VERSION}>
              {FORM_NOTICE[p.language]}
            </span>
          </NoticeBox>
        )}
      </div>
      {next(filled ? copy.continue : copy.codeSkip)}
    </>
  )
}
