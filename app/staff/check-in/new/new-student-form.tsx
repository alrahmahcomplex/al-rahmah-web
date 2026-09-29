"use client"

import Link from "next/link"
import { useId, useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/school-calendar"
import {
  DAY_OR_BOARDING,
  LEAD_CLASSES,
  RELATIONSHIPS,
  type DayOrBoarding,
  type InvalidField,
  type LeadClass,
  type Relationship,
} from "@/lib/services/leads"

import { registerWalkIn } from "../actions"
import type { RegisterOutcome, Step } from "../outcome"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const STEP_NUMBER: Record<Step, number> = { parent: 1, student: 2, review: 3 }
const STEP_TITLE: Record<Step, string> = {
  parent: "Parent or guardian",
  student: "Student",
  review: "Review",
}

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
}

type Refusal = Extract<RegisterOutcome, { status: "refused" }>

export function NewStudentForm({ today, years }: { today: string; years: number[] }) {
  const [step, setStep] = useState<Step>("parent")
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
  })
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [outcome, setOutcome] = useState<Extract<RegisterOutcome, { status: "created" | "duplicate" }> | null>(null)
  const [pending, startTransition] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)

  function set<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails((current) => ({ ...current, [key]: value }))
  }

  function goTo(next: Step) {
    setStep(next)
    setRefusal(null)
    // Keep keyboard and screen reader users at the top of the new step.
    queueMicrotask(() => headingRef.current?.focus())
  }

  function submit() {
    setRefusal(null)
    startTransition(async () => {
      const result = await registerWalkIn({
        contact: {
          fullName: details.parentName,
          relationship: details.relationship,
          relationshipDescription: details.relationship === "Other" ? details.relationshipDescription : undefined,
          phone: details.phone,
          whatsapp: details.whatsapp.trim() === "" ? undefined : details.whatsapp,
        },
        student: {
          fullName: details.studentName,
          className: details.className as LeadClass,
          enrollmentYear: Number(details.enrollmentYear),
          dayOrBoarding: details.dayOrBoarding as DayOrBoarding,
        },
        visitDate: details.visitDate,
      })

      if (result.status === "refused") {
        setRefusal(result)
        setStep(result.step)
        queueMicrotask(() => headingRef.current?.focus())
        return
      }
      setOutcome(result)
    })
  }

  if (outcome?.status === "created") {
    return <Confirmation admissionNumber={outcome.admissionNumber} leadId={outcome.leadId} studentName={details.studentName} />
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Step {STEP_NUMBER[step]} of 3
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
          {STEP_TITLE[step]}
        </h2>
      </div>

      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal.message}</AlertDescription>
        </Alert>
      )}

      {step === "parent" && (
        <ParentStep details={details} set={set} field={refusal?.field ?? null} onNext={() => goTo("student")} />
      )}
      {step === "student" && (
        <StudentStep
          details={details}
          set={set}
          today={today}
          years={years}
          field={refusal?.field ?? null}
          onBack={() => goTo("parent")}
          onNext={() => goTo("review")}
        />
      )}
      {step === "review" && (
        <ReviewStep
          details={details}
          pending={pending}
          duplicate={outcome?.status === "duplicate" ? outcome : null}
          onBack={() => {
            setOutcome(null)
            goTo("student")
          }}
          onSubmit={() => {
            setOutcome(null)
            submit()
          }}
        />
      )}
    </div>
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

function ParentStep({ details, set, field, onNext }: StepProps & { onNext: () => void }) {
  const phoneError = field === "phone" ? "Check this number." : null
  const whatsappError = field === "whatsapp" ? "Check this number." : null

  return (
    <form
      className="flex flex-col gap-4"
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
          />
        )}
      </Field>
      <Field label="Relationship to the student">
        {({ id }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            value={details.relationship}
            onChange={(event) => set("relationship", event.target.value as Relationship)}
          >
            {RELATIONSHIPS.map((relationship) => (
              <option key={relationship}>{relationship}</option>
            ))}
          </select>
        )}
      </Field>
      {details.relationship === "Other" && (
        <Field label="Describe the relationship" hint="For example: aunt, neighbour, sponsor.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              required
              autoComplete="off"
              value={details.relationshipDescription}
              onChange={(event) => set("relationshipDescription", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
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
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit">Continue</Button>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Cancel</Link>
      </div>
    </form>
  )
}

function StudentStep({
  details,
  set,
  today,
  years,
  field,
  onBack,
  onNext,
}: StepProps & { today: string; years: number[]; onBack: () => void; onNext: () => void }) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onNext()
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
          />
        )}
      </Field>
      <Field label="Class">
        {({ id }) => (
          <select
            id={id}
            required
            className={SELECT_CLASS}
            value={details.className}
            onChange={(event) => set("className", event.target.value as LeadClass)}
          >
            <option value="" disabled>
              Choose a class
            </option>
            {LEAD_CLASSES.map((className) => (
              <option key={className}>{className}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Enrollment year">
        {({ id }) => (
          <select
            id={id}
            required
            className={SELECT_CLASS}
            value={details.enrollmentYear}
            onChange={(event) => set("enrollmentYear", event.target.value)}
          >
            <option value="" disabled>
              Choose a year
            </option>
            {years.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Day or boarding</legend>
        <div className="flex gap-4">
          {DAY_OR_BOARDING.map((choice) => (
            <label key={choice} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="day-or-boarding"
                required
                value={choice}
                checked={details.dayOrBoarding === choice}
                onChange={() => set("dayOrBoarding", choice)}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Visit date"
        hint="Today, or an earlier day if you are recording a visit late."
        error={field === "visit_date" ? "Choose today or an earlier date." : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="date"
            required
            max={today}
            value={details.visitDate}
            onChange={(event) => set("visitDate", event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit">Review</Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  )
}

function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReviewStep({
  details,
  pending,
  duplicate,
  onBack,
  onSubmit,
}: {
  details: Details
  pending: boolean
  duplicate: Extract<RegisterOutcome, { status: "duplicate" }> | null
  onBack: () => void
  onSubmit: () => void
}) {
  const relationship =
    details.relationship === "Other" ? `Other: ${details.relationshipDescription}` : details.relationship

  return (
    <div className="flex flex-col gap-5">
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
      <section aria-labelledby="review-parent" className="flex flex-col gap-2">
        <h3 id="review-parent" className="text-sm font-semibold text-slate-900">
          Parent or guardian
        </h3>
        <Summary
          rows={[
            ["Full name", details.parentName],
            ["Relationship", relationship],
            ["Phone", details.phone],
            ["WhatsApp", details.whatsapp.trim() === "" ? "Same as phone" : details.whatsapp],
          ]}
        />
      </section>
      <section aria-labelledby="review-student" className="flex flex-col gap-2">
        <h3 id="review-student" className="text-sm font-semibold text-slate-900">
          Student
        </h3>
        <Summary
          rows={[
            ["Full name", details.studentName],
            ["Class", details.className],
            ["Enrollment year", details.enrollmentYear],
            ["Day or boarding", details.dayOrBoarding],
            ["Visit date", formatDate(details.visitDate)],
          ]}
        />
      </section>
      <div className="flex gap-2">
        <Button type="button" onClick={onSubmit} disabled={pending}>
          {pending ? "Registering…" : "Register student"}
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          Back
        </Button>
      </div>
    </div>
  )
}

function Confirmation({
  admissionNumber,
  leadId,
  studentName,
}: {
  admissionNumber: string
  leadId: string
  studentName: string
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(admissionNumber)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">{studentName} is registered</h2>
        <p className="text-sm text-slate-700">Give the family this Admission Number.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-5">
        <p aria-label="Admission Number" className="font-mono text-4xl font-bold tracking-wide text-blue-600">
          {admissionNumber}
        </p>
        <Button type="button" variant="outline" onClick={copy}>
          Copy number
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {copied === "yes" && "Copied."}
          {copied === "failed" && "Could not copy. Select the number and copy it by hand."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/staff/leads/${leadId}`} className={buttonVariants()}>Open lead</Link>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Back to Check-in</Link>
      </div>
    </div>
  )
}
