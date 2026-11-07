"use client"

import { ArrowLeftIcon, CheckIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { STAFF_REMINDER } from "@/lib/referral-notice"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { formatDate } from "@/lib/school-calendar"
import {
  DAY_OR_BOARDING,
  isClosed,
  LEAD_CLASSES,
  RELATIONSHIPS,
  type DayOrBoarding,
  type FamilyContact,
  type FamilyMatch,
  type InvalidField,
  type LeadClass,
  type Relationship,
} from "@/lib/services/leads"
import type { ReferralAgent } from "@/lib/services/referral"
import { cn } from "@/lib/utils"

import { HeaderActions } from "../../_shell/header-actions"
import type { CorrectionOutcome } from "../../leads/[id]/correction-outcome"
import { useCodeLookup } from "../../leads/[id]/referral-editor"
import { formatTzs, referralLookupNote, type ReferralLookup } from "../../leads/[id]/referral-outcome"
import { findFamily, registerWalkIn, updateSharedContact } from "../actions"
import { childHref, compareContact, relationshipLabel } from "../family"
import type { ReferralCodeResult, RegisterOutcome } from "../outcome"
import { CardGroup, ChipGroup, FIELD_CLASS, focusGroup } from "./choices"

const LOST_REQUEST_MESSAGE =
  "The registration could not be confirmed. Check your connection and register again. If the student comes back as already registered, the first attempt was saved."

const LOST_LOOKUP_MESSAGE =
  "The check for a known family could not be completed. Check your connection and try again, or continue without it: a student already on file is still refused when you register."

const LOST_UPDATE_MESSAGE =
  "The update could not be confirmed. Check your connection and try again, or keep the stored details."

// The one orange action on each screen (DESIGN.md, The ShuleFasta Button
// Rule), and the ghost Back beside it.
const PRIMARY = "h-11 rounded-full px-5 text-sm"
const BACK = "h-11 rounded-full px-4 text-sm text-slate-700"

const HEADING = "font-exo text-2xl font-extrabold italic text-blue-600 outline-none"

// The screens of New Student. The Family screens appear only when the
// parent's number is already on file.
type Screen = "parent" | "family" | "compare" | "student" | "review"

type Details = {
  parentName: string
  relationship: Relationship
  relationshipDescription: string
  phone: string
  whatsapp: string
  studentName: string
  className: LeadClass | ""
  enrollmentYear: string
  dayOrBoarding: DayOrBoarding | ""
  visitDate: string
  // The Referral code as typed; the agent it names is confirmed on Review.
  referralCode: string
}

// A refusal shown at the top of a screen, and the field it is about.
// `canSkip` offers going on without the Family check when the check failed.
type Notice = { screen: Screen; field: InvalidField | null; message: string; canSkip?: boolean }

export function NewStudentForm({
  today,
  years,
  canEditContact,
  canEnterReferralCode,
  interviewDiscount,
}: {
  today: string
  years: number[]
  canEditContact: boolean
  // Staff who may set a lead's Referral code (leads.edit) get the field.
  canEnterReferralCode: boolean
  // What an Approved agent's code takes off the interview fee, from
  // interview_discount(), or null when that read failed.
  interviewDiscount: number | null
}) {
  const [screen, setScreen] = useState<Screen>("parent")
  const [details, setDetails] = useState<Details>({
    parentName: "",
    relationship: "Mother",
    relationshipDescription: "",
    phone: "",
    whatsapp: "",
    studentName: "",
    className: "",
    enrollmentYear: "",
    dayOrBoarding: "",
    visitDate: today,
    referralCode: "",
  })
  // The Marketing Agent whose code the student step accepted, if any.
  const [referralAgent, setReferralAgent] = useState<ReferralAgent | null>(null)
  // The contacts that hold the parent's numbers, and the one staff confirmed
  // as the same person, if any.
  const [match, setMatch] = useState<FamilyMatch | null>(null)
  const [confirmed, setConfirmed] = useState<FamilyContact | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [duplicate, setDuplicate] = useState<Extract<RegisterOutcome, { status: "duplicate" }> | null>(null)
  const [created, setCreated] = useState<Extract<RegisterOutcome, { status: "created" }> | null>(null)
  const [pending, startTransition] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const known = Boolean(match && match.contacts.length > 0)

  function set<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails((current) => ({ ...current, [key]: value }))
  }

  function goTo(next: Screen, withNotice: Notice | null = null) {
    setScreen(next)
    setNotice(withNotice)
    // A refusal is about what was sent; leaving Review to change anything
    // retires it.
    setDuplicate(null)
    // Keep keyboard and screen reader users at the top of the new screen.
    queueMicrotask(() => headingRef.current?.focus())
  }

  // Every Continue on the parent looks again, so a changed number is never
  // matched against the last one's Family.
  function lookForFamily() {
    setNotice(null)
    setMatch(null)
    setConfirmed(null)
    startTransition(async () => {
      let result
      try {
        result = await findFamily({
          phone: details.phone,
          whatsapp: details.whatsapp.trim() === "" ? null : details.whatsapp,
        })
      } catch {
        setNotice({ screen: "parent", field: null, message: LOST_LOOKUP_MESSAGE, canSkip: true })
        return
      }
      if (result.status === "refused") {
        goTo("parent", { screen: "parent", field: result.field, message: result.message, canSkip: result.canSkip })
        return
      }
      if (result.status === "skipped") {
        goTo("student")
        return
      }
      setMatch(result.match)
      goTo(result.match.contacts.length > 0 ? "family" : "student")
    })
  }

  function registerSibling() {
    if (!confirmed || !match) return
    const { differs } = compareContact(typedParent(details, match), confirmed)
    goTo(differs ? "compare" : "student")
  }

  function updateContact(): Promise<CorrectionOutcome> {
    return new Promise((resolve) => {
      if (!confirmed || !match) return resolve({ status: "refused", field: null, message: LOST_UPDATE_MESSAGE })
      startTransition(async () => {
        let result: CorrectionOutcome
        try {
          result = await updateSharedContact({
            contactId: confirmed.id,
            contact: {
              fullName: details.parentName,
              relationship: details.relationship,
              relationshipDescription: details.relationship === "Other" ? details.relationshipDescription : undefined,
              phone: details.phone,
              whatsapp: details.whatsapp.trim() === "" ? undefined : details.whatsapp,
            },
            // Only the children on this contact: an unconfirmed one is on a
            // contact of its own, which this change does not reach.
            children: confirmed.children.filter((child) => !child.unconfirmed).map((child) => child.id),
          })
        } catch {
          result = { status: "refused", field: null, message: LOST_UPDATE_MESSAGE }
        }
        if (result.status === "saved") {
          const typed = typedParent(details, match)
          const updated: FamilyContact = {
            ...confirmed,
            // Trimmed only, as the database stores it.
            fullName: details.parentName.trim(),
            relationship: typed.relationship,
            relationshipDescription: typed.relationship === "Other" ? typed.relationshipDescription : null,
            phone: typed.phone,
            whatsapp: typed.whatsapp,
          }
          setConfirmed(updated)
          setMatch({ ...match, contacts: match.contacts.map((c) => (c.id === updated.id ? updated : c)) })
          goTo("student")
        }
        resolve(result)
      })
    })
  }

  function submit() {
    setNotice(null)
    setDuplicate(null)
    startTransition(async () => {
      let result: RegisterOutcome
      try {
        result = await registerWalkIn({
          guardian: confirmed
            ? {
                contactId: confirmed.id,
                // Checked for duplicates too, in case the stored contact
                // doesn't hold a number the parent gave today.
                typedPhones: [details.phone, details.whatsapp].filter((phone) => phone.trim() !== ""),
              }
            : {
                contact: {
                  fullName: details.parentName,
                  relationship: details.relationship,
                  relationshipDescription: details.relationship === "Other" ? details.relationshipDescription : undefined,
                  phone: details.phone,
                  whatsapp: details.whatsapp.trim() === "" ? undefined : details.whatsapp,
                },
              },
          student: {
            fullName: details.studentName,
            className: details.className as LeadClass,
            enrollmentYear: Number(details.enrollmentYear),
            dayOrBoarding: details.dayOrBoarding as DayOrBoarding,
          },
          visitDate: details.visitDate,
          referralCode: referralAgent?.code ?? null,
        })
      } catch {
        // The request never came back, so it may or may not have been saved.
        // Trying again is safe: a child who was saved comes back as already
        // registered, with the number.
        setNotice({ screen: "review", field: null, message: LOST_REQUEST_MESSAGE })
        return
      }

      if (result.status === "refused") {
        // A parent that has to be entered again is looked up again too.
        if (result.step === "parent") {
          setMatch(null)
          setConfirmed(null)
        }
        goTo(result.step, { screen: result.step, field: result.field, message: result.message })
        return
      }
      if (result.status === "duplicate") {
        setDuplicate(result)
        return
      }
      setCreated(result)
    })
  }

  // Another child of the same parent: the parent's details stay typed and
  // the Family check runs again, which now lists the child just registered.
  function registerAnother() {
    setCreated(null)
    setDuplicate(null)
    setReferralAgent(null)
    setMatch(null)
    setConfirmed(null)
    setDetails((current) => ({
      ...current,
      studentName: "",
      className: "",
      enrollmentYear: "",
      dayOrBoarding: "",
      visitDate: today,
      referralCode: "",
    }))
    goTo("parent")
  }

  if (created) {
    return (
      <Confirmation
        admissionNumber={created.admissionNumber}
        leadId={created.leadId}
        studentName={details.studentName}
        referralCode={created.referralCode}
        onAnother={registerAnother}
      />
    )
  }

  const steps: Screen[] = known ? ["parent", "family", "student", "review"] : ["parent", "student", "review"]
  const currentIndex = steps.indexOf(screen === "compare" ? "family" : screen)
  const stepNumber = currentIndex + 1
  const field = notice?.screen === screen ? notice.field : null
  const { question, help } = questionFor(screen, confirmed)

  const rail: RailStep[] = steps.map((key) => {
    switch (key) {
      case "parent":
        return {
          key,
          label: "Parent or guardian",
          hint: "Name and phone number",
          done: [
            `${details.parentName.trim()} · ${relationshipLabel(details.relationship, details.relationshipDescription.trim())}`,
            details.whatsapp.trim() ? `${details.phone} · WhatsApp ${details.whatsapp}` : details.phone,
          ],
        }
      case "family":
        return {
          key,
          label: "Family",
          hint: "A parent already on file",
          done: confirmed ? [`${confirmed.fullName}'s family`, childCount(confirmed.children.length)] : ["Not the same person"],
        }
      case "student":
        return {
          key,
          label: "Student",
          hint: "Who is being registered",
          done: [
            `${details.studentName.trim()} · ${details.className}`,
            `${details.enrollmentYear} · ${details.dayOrBoarding}${referralAgent ? ` · ${referralAgent.code}` : ""}`,
          ],
        }
      default:
        return { key, label: "Review and register", hint: "Admission Number is issued here", done: [] }
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Link href="/staff/check-in" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-slate-700")}>
          Cancel
        </Link>
      </HeaderActions>
      <Progress step={stepNumber} of={steps.length} />
      <div className="grid gap-6 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-12">
        <StepRail steps={rail} currentIndex={currentIndex} pending={pending} onChange={(key) => goTo(key)} />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 ref={headingRef} tabIndex={-1} className={HEADING}>
              {question}
            </h1>
            <p className="text-sm text-slate-600">{help}</p>
          </div>

          {notice?.screen === screen && (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{notice.message}</span>
                {notice.canSkip && (
                  <Button type="button" variant="outline" size="sm" onClick={() => goTo("student")}>
                    Continue without checking
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {screen === "parent" && (
            <ParentStep details={details} set={set} field={field} pending={pending} onNext={lookForFamily} />
          )}
          {screen === "family" && match && !confirmed && (
            <ChooseContactStep
              match={match}
              onSame={(contact) => {
                setConfirmed(contact)
                goTo("family")
              }}
              onNotSame={() => {
                // The declined contacts are done with: Back goes to the parent.
                setMatch(null)
                setConfirmed(null)
                goTo("student")
              }}
              onBack={() => goTo("parent")}
            />
          )}
          {screen === "family" && confirmed && (
            <FamilyChildrenStep
              contact={confirmed}
              onRegisterSibling={registerSibling}
              onBack={() => {
                setConfirmed(null)
                goTo("family")
              }}
            />
          )}
          {screen === "compare" && match && confirmed && (
            <CompareStep
              details={details}
              match={match}
              contact={confirmed}
              canEdit={canEditContact}
              pending={pending}
              onUpdate={updateContact}
              onKeep={() => goTo("student")}
              onBack={() => goTo("family")}
            />
          )}
          {screen === "student" && (
            <StudentStep
              details={details}
              set={set}
              today={today}
              years={years}
              field={field}
              canEnterReferralCode={canEnterReferralCode}
              interviewDiscount={interviewDiscount}
              onBack={() => goTo(known ? "family" : "parent")}
              onNext={(agent) => {
                setReferralAgent(agent)
                goTo("review")
              }}
            />
          )}
          {screen === "review" && (
            <ReviewStep
              details={details}
              contact={confirmed}
              referralAgent={referralAgent}
              pending={pending}
              duplicate={duplicate}
              onChangeParent={() => goTo("parent")}
              onChangeStudent={() => goTo("student")}
              onBack={() => goTo("student")}
              onSubmit={submit}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// What each screen asks, as the page's heading, and the sentence under it.
function questionFor(screen: Screen, confirmed: FamilyContact | null): { question: string; help: string } {
  switch (screen) {
    case "parent":
      return {
        question: "Who is the parent or guardian?",
        help: "Ask the parent. Their phone number tells us whether the family is already known.",
      }
    case "family":
      return confirmed
        ? {
            question: `${confirmed.fullName}'s family`,
            help: "If the student is listed, open them instead of registering again. If not, register a new sibling.",
          }
        : {
            question: "Is this the same parent?",
            help: "This number is already on file. Check the name and relationship with the parent.",
          }
    case "compare":
      return { question: "Update the shared contact?", help: "What you typed differs from the contact on file." }
    case "student":
      return { question: "Who is the student?", help: "Ask the parent. Everything can be corrected later from the student's page." }
    case "review":
      return { question: "Check and register", help: "Read it back to the parent. Register issues the Admission Number." }
  }
}

// The parent as typed, with the numbers the Family lookup normalized.
function typedParent(details: Details, match: FamilyMatch) {
  return {
    fullName: details.parentName.trim().replace(/\s+/g, " "),
    relationship: details.relationship,
    relationshipDescription: details.relationshipDescription.trim(),
    phone: match.phone,
    whatsapp: match.whatsapp,
  }
}

function Progress({ step, of }: { step: number; of: number }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={of}
        aria-valuenow={step}
        className="h-1 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${Math.round((step / of) * 100)}%` }} />
      </div>
      <p id={id} className="text-xs text-muted-foreground">
        Step {step} of {of}
      </p>
    </div>
  )
}

// A step as the rail shows it: its name, what to expect while it is ahead,
// and what was entered once it is done.
type RailStep = { key: Screen; label: string; hint: string; done: string[] }

// The steps beside the form (above it on a phone): a completed step shows
// what was entered and a Change link back to it. While a request runs the
// links wait, so what was sent and what is shown stay the same.
function StepRail({
  steps,
  currentIndex,
  pending,
  onChange,
}: {
  steps: RailStep[]
  currentIndex: number
  pending: boolean
  onChange: (key: Screen) => void
}) {
  return (
    <ol aria-label="Steps" className="flex flex-col md:pt-1">
      {steps.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming"
        return (
          <li key={step.key} aria-current={state === "current" ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0 md:pb-6">
            {index < steps.length - 1 && <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-0.5 bg-slate-200" />}
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2 bg-white text-xs font-semibold",
                state === "done"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : state === "current"
                    ? "border-blue-600 text-blue-600"
                    : "border-slate-300 text-slate-500",
              )}
            >
              {state === "done" ? <CheckIcon className="size-4" /> : index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-1">
              <p className={cn("text-sm font-semibold", state === "upcoming" ? "text-slate-500" : "text-slate-900")}>
                {state === "done" && <span className="sr-only">Done: </span>}
                {step.label}
              </p>
              {state === "done" ? (
                step.done.map((line) => (
                  <p key={line} className="truncate text-xs text-slate-600">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{step.hint}</p>
              )}
              {state === "done" && (
                <button
                  type="button"
                  onClick={() => onChange(step.key)}
                  disabled={pending}
                  aria-label={`Change ${step.label.toLowerCase()}`}
                  className="w-fit rounded-sm text-xs font-medium text-blue-600 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-blue-600/40 disabled:opacity-50"
                >
                  Change
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

type StepProps = {
  details: Details
  set: <K extends keyof Details>(key: K, value: Details[K]) => void
  field: InvalidField | null
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, describedBy: hint || error ? hintId : undefined, invalid: Boolean(error) })}
      {(hint || error) && (
        <p id={hintId} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

// The actions at the foot of a screen: the one orange action first, then Back.
function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">{children}</div>
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="ghost" className={BACK} onClick={onClick} disabled={disabled}>
      <ArrowLeftIcon aria-hidden />
      Back
    </Button>
  )
}

function ParentStep({ details, set, field, pending, onNext }: StepProps & { pending: boolean; onNext: () => void }) {
  const phoneError = field === "phone" ? "Check this number." : null
  const whatsappError = field === "whatsapp" ? "Check this number." : null

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        onNext()
      }}
    >
      <Field label="Full name">
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            required
            autoComplete="off"
            value={details.parentName}
            onChange={(event) => set("parentName", event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={FIELD_CLASS}
          />
        )}
      </Field>
      <ChipGroup
        label="Relationship to the student"
        options={RELATIONSHIPS}
        value={details.relationship}
        onChange={(relationship) => set("relationship", relationship)}
        error={field === "relationship" ? "Choose how they are related to the student." : null}
      />
      {details.relationship === "Other" && (
        <Field
          label="Describe the relationship"
          hint="For example: aunt, neighbour, sponsor."
          error={field === "relationship_description" ? "Say how they are related to the student." : null}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              required
              autoComplete="off"
              value={details.relationshipDescription}
              onChange={(event) => set("relationshipDescription", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={FIELD_CLASS}
            />
          )}
        </Field>
      )}
      <Field label="Phone" hint="The number they answer. For example 0712 345 678." error={phoneError}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="tel"
            required
            autoComplete="off"
            value={details.phone}
            onChange={(event) => set("phone", event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={FIELD_CLASS}
          />
        )}
      </Field>
      <Field label="WhatsApp number (optional)" hint="Only if it differs from the phone." error={whatsappError}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="tel"
            autoComplete="off"
            value={details.whatsapp}
            onChange={(event) => set("whatsapp", event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={FIELD_CLASS}
          />
        )}
      </Field>
      <Footer>
        <Button type="submit" variant="orange" className={PRIMARY} disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </Footer>
    </form>
  )
}

function childCount(count: number) {
  return count === 1 ? "1 child on file" : `${count} children on file`
}

function ChooseContactStep({
  match,
  onSame,
  onNotSame,
  onBack,
}: {
  match: FamilyMatch
  onSame: (contact: FamilyContact) => void
  onNotSame: () => void
  onBack: () => void
}) {
  const several = match.contacts.length > 1
  return (
    <div className="flex flex-col gap-4">
      {several && (
        <p className="text-sm text-slate-700">
          This number is on file for {match.contacts.length} parents or guardians. Choose the one they are, or Not the same
          person if none fits.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {match.contacts.map((contact) => (
          <li key={contact.id}>
            <ContactCard contact={contact} primary={!several} onSame={() => onSame(contact)} />
          </li>
        ))}
      </ul>
      <Footer>
        <Button type="button" variant="outline" className={PRIMARY} onClick={onNotSame}>
          Not the same person
        </Button>
        <BackButton onClick={onBack} />
      </Footer>
    </div>
  )
}

// A contact that holds the number. Same person is the one orange action
// when there is one contact; with several, none is the obvious next step.
function ContactCard({ contact, primary, onSame }: { contact: FamilyContact; primary: boolean; onSame: () => void }) {
  const nameId = useId()
  return (
    <div
      role="group"
      aria-labelledby={nameId}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p id={nameId} className="font-semibold break-words text-slate-900">
          {contact.fullName}
        </p>
        <p className="text-sm text-slate-700">{relationshipLabel(contact.relationship, contact.relationshipDescription)}</p>
        <p className="text-xs text-muted-foreground">{childCount(contact.children.length)}</p>
      </div>
      <Button type="button" variant={primary ? "orange" : "outline"} className={PRIMARY} onClick={onSame}>
        Same person
      </Button>
    </div>
  )
}

function FamilyChildrenStep({
  contact,
  onRegisterSibling,
  onBack,
}: {
  contact: FamilyContact
  onRegisterSibling: () => void
  onBack: () => void
}) {
  const anyClosed = contact.children.some(isClosed)
  return (
    <div className="flex flex-col gap-4">
      {contact.children.length === 0 ? (
        <p className="text-sm text-muted-foreground">No children are on file for this parent or guardian.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Children on file" className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">Class</th>
                <th scope="col" className="px-3 py-2 font-medium">Year</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {contact.children.map((child) => {
                const closed = isClosed(child)
                return (
                  <tr key={child.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{child.admissionNumber}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{child.studentName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{child.className}</td>
                    <td className="px-3 py-2">{child.enrollmentYear}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={child.status === "Declined" ? "destructive" : "secondary"}>{child.status}</Badge>
                        {child.closure && <Badge variant="outline">{child.closure}</Badge>}
                        {child.unconfirmed && <Badge variant="outline">Unconfirmed</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link
                        href={childHref(child)}
                        aria-label={closed ? `Reopening request for ${child.studentName}` : `Open ${child.studentName}`}
                        className="font-medium text-blue-600 underline underline-offset-4"
                      >
                        {closed ? "Reopening request" : "Open"}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {anyClosed && (
        <p className="text-xs text-muted-foreground">
          A Declined, Inactive or Archived child comes back through a Reopening request, not a new registration.
        </p>
      )}
      {contact.children.some((child) => child.unconfirmed) && (
        <p className="text-xs text-muted-foreground">
          An unconfirmed child came through the Admission form with this number. Staff confirm or reject the match on
          that child&apos;s lead.
        </p>
      )}
      <Footer>
        <Button type="button" variant="orange" className={PRIMARY} onClick={onRegisterSibling}>
          Register a new sibling
        </Button>
        <BackButton onClick={onBack} />
      </Footer>
    </div>
  )
}

function CompareStep({
  details,
  match,
  contact,
  canEdit,
  pending,
  onUpdate,
  onKeep,
  onBack,
}: {
  details: Details
  match: FamilyMatch
  contact: FamilyContact
  canEdit: boolean
  pending: boolean
  onUpdate: () => Promise<CorrectionOutcome>
  onKeep: () => void
  onBack: () => void
}) {
  const [refusal, setRefusal] = useState<Exclude<CorrectionOutcome, { status: "saved" }> | null>(null)
  const { rows } = compareContact(typedParent(details, match), contact)
  const siblings = contact.children.filter((child) => !child.unconfirmed).map((child) => child.studentName)

  return (
    <div className="flex flex-col gap-4">
      {siblings.length > 0 && (
        <p className="text-sm text-slate-700">
          The contact is shared by {siblings.join(", ")}, so updating it changes it for every one of them.
        </p>
      )}
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col gap-2">
            {refusal.status === "duplicate" ? (
              <>
                <span>
                  These numbers would make a child on this contact match{" "}
                  <span className="font-mono font-semibold">{refusal.admissionNumber}</span>. Nothing was changed.
                </span>
                <Link href={refusal.href} className="font-medium underline underline-offset-4">
                  Open {refusal.admissionNumber}
                </Link>
              </>
            ) : (
              <span>{refusal.message}</span>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table aria-label="Typed and stored details" className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Detail</span>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">You typed</th>
              <th scope="col" className="px-3 py-2 font-medium">On file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.differs ? "border-b bg-amber-50 last:border-b-0" : "border-b last:border-b-0"}>
                <th scope="row" className="px-3 py-2 font-medium text-muted-foreground">
                  {row.label}
                  {row.differs && <span className="sr-only"> (differs)</span>}
                </th>
                <td className={row.differs ? "px-3 py-2 font-semibold break-words text-slate-900" : "px-3 py-2 break-words"}>
                  {row.typed}
                </td>
                <td className="px-3 py-2 break-words">{row.stored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Your role can&apos;t change a shared contact, so the stored details are kept.
        </p>
      )}
      <Footer>
        {canEdit && (
          <Button
            type="button"
            variant="orange"
            className={PRIMARY}
            disabled={pending}
            onClick={async () => {
              setRefusal(null)
              const result = await onUpdate()
              if (result.status !== "saved") setRefusal(result)
            }}
          >
            {pending ? "Updating…" : "Update the shared contact"}
          </Button>
        )}
        <Button type="button" variant={canEdit ? "outline" : "orange"} className={PRIMARY} disabled={pending} onClick={onKeep}>
          Keep stored details
        </Button>
        <BackButton onClick={onBack} disabled={pending} />
      </Footer>
    </div>
  )
}

// The choices the student step checks itself before going on: the database
// refuses them too, but staff should hear it before Review.
type MissingChoice = Extract<InvalidField, "class_name" | "enrollment_year" | "day_or_boarding">

const MISSING_MESSAGE: Record<MissingChoice, string> = {
  class_name: "Choose the student's class.",
  enrollment_year: "Choose the year the student will enroll.",
  day_or_boarding: "Choose day or boarding.",
}

const DAY_OR_BOARDING_MEANS: Record<DayOrBoarding, string> = {
  Day: "Goes home after school each day.",
  Boarding: "Lives at the school during term.",
}

function StudentStep({
  details,
  set,
  today,
  years,
  field,
  canEnterReferralCode,
  interviewDiscount,
  onBack,
  onNext,
}: StepProps & {
  today: string
  years: number[]
  canEnterReferralCode: boolean
  interviewDiscount: number | null
  onBack: () => void
  onNext: (agent: ReferralAgent | null) => void
}) {
  const typedCode = canEnterReferralCode ? details.referralCode : ""
  const lookup = useCodeLookup(typedCode)
  const [codeRefusal, setCodeRefusal] = useState<string | null>(null)
  const [missing, setMissing] = useState<MissingChoice | null>(null)
  const [visitOpened, setVisitOpened] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  const groupIds = { class_name: `${ids}-class`, enrollment_year: `${ids}-year`, day_or_boarding: `${ids}-mode` }

  // The visit date reads as a line until staff change it, or until the
  // database refuses it, or when it is no longer today. Choosing to change
  // it puts the cursor in the field once it is on screen.
  const visitOpen = visitOpened || field === "visit_date" || details.visitDate !== today
  useEffect(() => {
    if (visitOpened) dateRef.current?.focus()
  }, [visitOpened])

  function choiceError(choice: MissingChoice) {
    return missing === choice || field === choice ? MISSING_MESSAGE[choice] : null
  }

  function chose(choice: MissingChoice) {
    setMissing((current) => (current === choice ? null : current))
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        const unchosen: MissingChoice | null = !details.className
          ? "class_name"
          : !details.enrollmentYear
            ? "enrollment_year"
            : !details.dayOrBoarding
              ? "day_or_boarding"
              : null
        if (unchosen) {
          setMissing(unchosen)
          focusGroup(groupIds[unchosen])
          return
        }
        if (typedCode.trim() === "") return onNext(null)
        // Only a code a Marketing Agent holds goes on to Review.
        if (lookup.status === "found") return onNext(lookup.agent)
        setCodeRefusal(codeRefusalMessage(lookup))
        codeRef.current?.focus()
      }}
    >
      <Field label="Student's full name">
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            required
            autoComplete="off"
            value={details.studentName}
            onChange={(event) => set("studentName", event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={FIELD_CLASS}
          />
        )}
      </Field>
      <ChipGroup
        id={groupIds.class_name}
        label="Class they are joining"
        options={LEAD_CLASSES}
        value={details.className}
        onChange={(className) => {
          chose("class_name")
          set("className", className)
        }}
        hint={details.className === "FORM 1" ? "For FORM 1 you can add the Pre-Form One programme after registration." : undefined}
        error={choiceError("class_name")}
      />
      <ChipGroup
        id={groupIds.enrollment_year}
        label="Enrollment year"
        options={years.map(String)}
        value={details.enrollmentYear}
        onChange={(year) => {
          chose("enrollment_year")
          set("enrollmentYear", year)
        }}
        error={choiceError("enrollment_year")}
      />
      <CardGroup
        id={groupIds.day_or_boarding}
        label="Day or boarding"
        options={DAY_OR_BOARDING}
        value={details.dayOrBoarding}
        onChange={(mode) => {
          chose("day_or_boarding")
          set("dayOrBoarding", mode)
        }}
        describe={(mode) => DAY_OR_BOARDING_MEANS[mode]}
        error={choiceError("day_or_boarding")}
      />
      {canEnterReferralCode && (
        <ReferralCodeField
          ref={codeRef}
          value={details.referralCode}
          lookup={lookup}
          refusal={codeRefusal}
          interviewDiscount={interviewDiscount}
          onChange={(value) => {
            setCodeRefusal(null)
            set("referralCode", value)
          }}
        />
      )}
      {visitOpen && (
        <Field
          label="Visit date"
          hint="Today, or an earlier day if you are recording a visit late."
          error={field === "visit_date" ? "Choose today or an earlier date." : null}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              ref={dateRef}
              id={id}
              type="date"
              required
              max={today}
              value={details.visitDate}
              onChange={(event) => set("visitDate", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={cn(FIELD_CLASS, "max-w-xs")}
            />
          )}
        </Field>
      )}
      <Footer>
        <Button type="submit" variant="orange" className={PRIMARY}>
          Continue to review
        </Button>
        <BackButton onClick={onBack} />
        {!visitOpen && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            Visit date: today, {formatDate(details.visitDate)} ·{" "}
            <button
              type="button"
              aria-label="Change visit date"
              className="rounded-sm font-medium text-blue-600 underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
              onClick={() => setVisitOpened(true)}
            >
              change
            </button>
          </p>
        )}
      </Footer>
    </form>
  )
}

// Why Review didn't go on with the typed code.
function codeRefusalMessage(lookup: ReferralLookup): string {
  switch (lookup.status) {
    case "checking":
      return "The code is still being checked. Wait a moment, then choose Continue to review again."
    case "unavailable":
      return "The code could not be checked just now. Try again, or clear the field and add the code on the lead later."
    default:
      return "No Marketing Agent has this code. Correct it, or clear the field to register without one."
  }
}

// What the field says under a code an agent holds: for an Approved agent,
// the interview fee the family will pay, when the discount could be read.
function agentNote(lookup: ReferralLookup, interviewDiscount: number | null): string {
  if (lookup.status === "found" && lookup.agent.state === "approved" && interviewDiscount !== null) {
    return `${lookup.agent.fullName} · interview fee becomes ${formatTzs(STANDARD_INTERVIEW_FEE - interviewDiscount)}`
  }
  return referralLookupNote(lookup)
}

// The optional Referral code, naming the agent as it is typed.
function ReferralCodeField({
  ref,
  value,
  lookup,
  refusal,
  interviewDiscount,
  onChange,
}: {
  ref: React.Ref<HTMLInputElement>
  value: string
  lookup: ReferralLookup
  refusal: string | null
  interviewDiscount: number | null
  onChange: (value: string) => void
}) {
  const id = useId()
  const note =
    refusal ?? (lookup.status === "empty" ? "Only if the family has a Marketing Agent's code, such as ABC-123." : agentNote(lookup, interviewDiscount))
  const invalid = refusal !== null || lookup.status === "none"
  const confirmed = refusal === null && lookup.status === "found" && lookup.agent.state === "approved"
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        Referral code <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Input
        ref={ref}
        id={id}
        name="referral_code"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        aria-describedby={value.trim() ? `${id}-agent ${id}-reminder` : `${id}-agent`}
        aria-invalid={invalid || undefined}
        className={cn(FIELD_CLASS, "max-w-56 font-mono uppercase")}
      />
      <p
        id={`${id}-agent`}
        role="status"
        className={cn(
          "flex items-start gap-1.5 text-sm",
          invalid ? "text-destructive" : confirmed ? "text-emerald-700" : lookup.status === "found" ? "text-slate-900" : "text-muted-foreground",
        )}
      >
        {confirmed && <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <span>{note}</span>
      </p>
      {/* A code staff save records that the family was told (#182). */}
      {value.trim() && (
        <p id={`${id}-reminder`} data-notice-version="staff_reminder" className="text-xs text-slate-900">
          {STAFF_REMINDER}
        </p>
      )}
    </div>
  )
}

function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="text-sm">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 border-t border-slate-100 py-2 first:border-t-0 first:pt-0 last:pb-0"
        >
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-medium break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// One card of the receipt-style review, with its way back to the step.
function ReviewCard({
  id,
  title,
  changeLabel,
  onChange,
  disabled,
  children,
}: {
  id: string
  title: string
  changeLabel: string
  onChange: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={onChange}
          disabled={disabled}
          aria-label={changeLabel}
          className="rounded-sm text-xs font-medium text-blue-600 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-blue-600/40 disabled:opacity-50"
        >
          Change
        </button>
      </div>
      {children}
    </section>
  )
}

function ReviewStep({
  details,
  contact,
  referralAgent,
  pending,
  duplicate,
  onChangeParent,
  onChangeStudent,
  onBack,
  onSubmit,
}: {
  details: Details
  // The confirmed contact the student joins, or null for a new one.
  contact: FamilyContact | null
  referralAgent: ReferralAgent | null
  pending: boolean
  duplicate: Extract<RegisterOutcome, { status: "duplicate" }> | null
  onChangeParent: () => void
  onChangeStudent: () => void
  onBack: () => void
  onSubmit: () => void
}) {
  const parentRows: [string, string][] = contact
    ? [
        ["Full name", contact.fullName],
        ["Relationship", relationshipLabel(contact.relationship, contact.relationshipDescription)],
        ["Phone", contact.phone],
        ["WhatsApp", contact.whatsapp ?? "Same as phone"],
        ["Family", `Returning family (${childCount(contact.children.length)})`],
      ]
    : [
        ["Full name", details.parentName],
        ["Relationship", relationshipLabel(details.relationship, details.relationshipDescription)],
        ["Phone", details.phone],
        ["WhatsApp", details.whatsapp.trim() === "" ? "Same as phone" : details.whatsapp],
      ]

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {duplicate && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col gap-2">
            <span>
              <strong>Already registered.</strong> This student is on file as{" "}
              <span className="font-mono font-semibold">{duplicate.admissionNumber}</span>. Nothing new was created.
            </span>
            <Link href={duplicate.href} className="font-medium underline underline-offset-4">
              Open {duplicate.admissionNumber}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <ReviewCard id="review-parent" title="Parent or guardian" changeLabel="Change parent or guardian" onChange={onChangeParent} disabled={pending}>
        <Summary rows={parentRows} />
      </ReviewCard>
      <ReviewCard id="review-student" title="Student" changeLabel="Change student" onChange={onChangeStudent} disabled={pending}>
        <Summary
          rows={[
            ["Full name", details.studentName],
            ["Class", details.className],
            ["Enrollment year", details.enrollmentYear],
            ["Day or boarding", details.dayOrBoarding],
            ["Visit date", formatDate(details.visitDate)],
            ...(referralAgent
              ? ([
                  ["Referral code", referralAgent.code],
                  ["Marketing Agent", referralAgent.fullName],
                ] as [string, string][])
              : []),
          ]}
        />
      </ReviewCard>
      <Footer>
        <Button type="button" variant="orange" className={PRIMARY} onClick={onSubmit} disabled={pending}>
          {pending ? "Registering…" : "Register student"}
        </Button>
        <BackButton onClick={onBack} disabled={pending} />
      </Footer>
    </div>
  )
}

function Confirmation({
  admissionNumber,
  leadId,
  studentName,
  referralCode,
  onAnother,
}: {
  admissionNumber: string
  leadId: string
  studentName: string
  referralCode: ReferralCodeResult
  onAnother: () => void
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const numberLabelId = useId()

  // A new screen, so focus moves to its heading as on every other.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(admissionNumber)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 ref={headingRef} tabIndex={-1} className={HEADING}>
          {studentName} is registered
        </h1>
        <p className="text-sm text-slate-600">
          Tell the parent: “{studentName}&apos;s Admission Number is {admissionNumber}. Keep it; the school asks for it at every
          visit.”
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <p id={numberLabelId} className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
          Admission Number
        </p>
        <p aria-labelledby={numberLabelId} className="font-mono text-4xl font-bold tracking-wide text-blue-600 sm:text-5xl">
          {admissionNumber}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={copy}>
            Copy number
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {copied === "yes" && "Copied."}
            {copied === "failed" && "Could not copy. Select the number and copy it by hand."}
          </p>
        </div>
      </div>
      {referralCode === "not-saved" && (
        <Alert role="alert" className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertDescription className="flex flex-col items-start gap-2 text-amber-950">
            <span>The lead was created, but the referral code wasn&apos;t saved.</span>
            <Link href={`/staff/leads/${leadId}#lead-referral`} className="font-medium underline underline-offset-4">
              Add the referral code
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Link href={`/staff/leads/${leadId}`} className={cn(buttonVariants({ variant: "orange" }), PRIMARY)}>
          Open {studentName}
        </Link>
        <Button type="button" variant="outline" className={PRIMARY} onClick={onAnother}>
          Register another child
        </Button>
      </div>
    </div>
  )
}
