"use client"

import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DAY_OR_BOARDING,
  LEAD_CLASSES,
  RELATIONSHIPS,
  type ContactChild,
  type DayOrBoarding,
  type InvalidField,
  type Lead,
  type LeadClass,
  type Relationship,
} from "@/lib/services/leads"

import { correctContact, correctStudent, correctVisit } from "./actions"
import type { CorrectionOutcome } from "./correction-outcome"

export const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const LOST_REQUEST: CorrectionOutcome = {
  status: "refused",
  field: null,
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

type Unsaved = Exclude<CorrectionOutcome, { status: "saved" }>

// Saves through a Server Action, keeping the refusal to show in the form.
// A saved change closes the form and says so.
export function useCorrection(onSaved: () => void) {
  const [refusal, setRefusal] = useState<Unsaved | null>(null)
  const [pending, startTransition] = useTransition()

  function save(action: () => Promise<CorrectionOutcome>) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: CorrectionOutcome
      try {
        outcome = await action()
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onSaved()
      else setRefusal(outcome)
    })
  }

  return { refusal, pending, save }
}

export function Saved({ message }: { message: string | null }) {
  return (
    <p role="status" className="text-sm text-emerald-700">
      {message}
    </p>
  )
}

export function Refusal({ refusal }: { refusal: Unsaved | null }) {
  if (!refusal) return null
  if (refusal.status === "duplicate") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          This change would make the student a duplicate of{" "}
          <Link href={refusal.href} className="font-mono font-semibold underline">
            {refusal.admissionNumber}
          </Link>
          , which is already on file. Nothing was changed.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{refusal.message}</AlertDescription>
    </Alert>
  )
}

export function Field({
  label,
  hint,
  invalid,
  children,
}: {
  label: string
  hint?: string
  invalid?: boolean
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, describedBy: hint ? hintId : undefined, invalid: Boolean(invalid) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

function FormButtons({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
    </div>
  )
}

// The Student section: its details, and in their place the form to correct
// them or the Visit date, for staff whose role may.
export function StudentEditor({
  lead,
  years,
  today,
  canEditDetails,
  canCorrectVisit,
  children,
}: {
  lead: Lead
  years: number[]
  today: string
  canEditDetails: boolean
  canCorrectVisit: boolean
  children: React.ReactNode
}) {
  const [editing, setEditing] = useState<"details" | "visit" | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function open(form: "details" | "visit") {
    setSaved(null)
    setEditing(form)
  }

  if (editing === "details") {
    return (
      <StudentDetailsForm
        lead={lead}
        years={years}
        onDone={(message) => {
          setEditing(null)
          setSaved(message)
        }}
      />
    )
  }
  if (editing === "visit") {
    return (
      <VisitDateForm
        lead={lead}
        today={today}
        onDone={(message) => {
          setEditing(null)
          setSaved(message)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {children}
      {(canEditDetails || canCorrectVisit) && (
        <div className="flex flex-wrap gap-2">
          {canEditDetails && (
            <Button type="button" variant="outline" size="sm" onClick={() => open("details")}>
              Edit student
            </Button>
          )}
          {canCorrectVisit && (
            <Button type="button" variant="outline" size="sm" onClick={() => open("visit")}>
              Correct Visit date
            </Button>
          )}
        </div>
      )}
      <Saved message={saved} />
    </div>
  )
}

function StudentDetailsForm({
  lead,
  years,
  onDone,
}: {
  lead: Lead
  years: number[]
  onDone: (saved: string | null) => void
}) {
  const [studentName, setStudentName] = useState(lead.studentName)
  const [className, setClassName] = useState<LeadClass>(lead.className)
  const [enrollmentYear, setEnrollmentYear] = useState(String(lead.enrollmentYear))
  const [dayOrBoarding, setDayOrBoarding] = useState<DayOrBoarding>(lead.dayOrBoarding)
  const { refusal, pending, save } = useCorrection(() => onDone("Student details saved."))
  const invalid = (field: InvalidField) => refusal?.status === "refused" && refusal.field === field
  // The year on the lead stays choosable, even once it has passed.
  const yearChoices = Array.from(new Set([lead.enrollmentYear, ...years])).sort((a, b) => a - b)

  return (
    <form
      aria-label="Edit student"
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() =>
          correctStudent(lead.id, {
            fullName: studentName,
            className,
            enrollmentYear: Number(enrollmentYear),
            dayOrBoarding,
          }),
        )
      }}
    >
      <Refusal refusal={refusal} />
      <Field label="Student's full name" invalid={invalid("student_name")}>
        {({ id, invalid }) => (
          <Input
            id={id}
            required
            autoComplete="off"
            value={studentName}
            onChange={(event) => setStudentName(event.target.value)}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field label="Class" invalid={invalid("class_name")}>
        {({ id, invalid }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            value={className}
            onChange={(event) => setClassName(event.target.value as LeadClass)}
            aria-invalid={invalid || undefined}
          >
            {LEAD_CLASSES.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Enrollment year" invalid={invalid("enrollment_year")}>
        {({ id, invalid }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            value={enrollmentYear}
            onChange={(event) => setEnrollmentYear(event.target.value)}
            aria-invalid={invalid || undefined}
          >
            {yearChoices.map((year) => (
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
                value={choice}
                checked={dayOrBoarding === choice}
                onChange={() => setDayOrBoarding(choice)}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>
      <FormButtons pending={pending} onCancel={() => onDone(null)} />
    </form>
  )
}

function VisitDateForm({ lead, today, onDone }: { lead: Lead; today: string; onDone: (saved: string | null) => void }) {
  const [visitDate, setVisitDate] = useState(lead.visitDate ?? today)
  const { refusal, pending, save } = useCorrection(() => onDone("Visit date saved."))

  return (
    <form
      aria-label="Correct Visit date"
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => correctVisit(lead.id, visitDate))
      }}
    >
      <Refusal refusal={refusal} />
      <Field label="Visit date" hint="The day the family came to campus: today or earlier.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            max={today}
            value={visitDate}
            onChange={(event) => setVisitDate(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.status === "refused" && refusal.field === "visit_date" ? true : undefined}
          />
        )}
      </Field>
      <FormButtons pending={pending} onCancel={() => onDone(null)} />
    </form>
  )
}

// The Parent or guardian section: its details, and in their place the form
// to correct them, for staff whose role may. A contact shared with siblings
// names them before the change is saved, because it reaches them all, a
// closed sibling's lead included.
export function ContactEditor({
  lead,
  siblings,
  canEdit,
  children,
}: {
  lead: Lead
  // The other children on this contact.
  siblings: ContactChild[]
  canEdit: boolean
  children: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  if (editing) {
    return (
      <ContactForm
        lead={lead}
        siblings={siblings}
        onDone={(message) => {
          setEditing(false)
          setSaved(message)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {children}
      {canEdit && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSaved(null)
              setEditing(true)
            }}
          >
            Edit parent or guardian
          </Button>
        </div>
      )}
      <Saved message={saved} />
    </div>
  )
}

function ContactForm({
  lead,
  siblings,
  onDone,
}: {
  lead: Lead
  siblings: ContactChild[]
  onDone: (saved: string | null) => void
}) {
  const { contact } = lead
  const [fullName, setFullName] = useState(contact.fullName)
  const [relationship, setRelationship] = useState<Relationship>(contact.relationship)
  const [relationshipDescription, setRelationshipDescription] = useState(contact.relationshipDescription ?? "")
  const [phone, setPhone] = useState(contact.phone)
  const [whatsapp, setWhatsapp] = useState(contact.whatsapp ?? "")
  const shared = siblings.length > 0
  const { refusal, pending, save } = useCorrection(() =>
    onDone(shared ? "Parent or guardian saved for every child on this contact." : "Parent or guardian saved."),
  )
  const invalid = (field: InvalidField) => refusal?.status === "refused" && refusal.field === field

  return (
    <form
      aria-label="Edit parent or guardian"
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() =>
          correctContact(
            contact.id,
            {
              fullName,
              relationship,
              relationshipDescription: relationship === "Other" ? relationshipDescription : null,
              phone,
              whatsapp: whatsapp.trim() === "" ? null : whatsapp,
            },
            [lead.id, ...siblings.map((child) => child.id)],
          ),
        )
      }}
    >
      <Refusal refusal={refusal} />
      <Field label="Full name" invalid={invalid("contact_name")}>
        {({ id, invalid }) => (
          <Input
            id={id}
            required
            autoComplete="off"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field label="Relationship to the student" invalid={invalid("relationship")}>
        {({ id }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as Relationship)}
          >
            {RELATIONSHIPS.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </select>
        )}
      </Field>
      {relationship === "Other" && (
        <Field
          label="Describe the relationship"
          hint="For example: aunt, neighbour, sponsor."
          invalid={invalid("relationship_description")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              required
              autoComplete="off"
              value={relationshipDescription}
              onChange={(event) => setRelationshipDescription(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
            />
          )}
        </Field>
      )}
      <Field label="Phone" hint="The number they answer. For example 0712 345 678." invalid={invalid("phone")}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="tel"
            required
            autoComplete="off"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field
        label="WhatsApp number (optional)"
        hint="Only if it differs from the phone. Leave it empty if it is the same."
        invalid={invalid("whatsapp")}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="tel"
            autoComplete="off"
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      {shared && (
        <Alert>
            <AlertDescription>
              <p>
                This parent or guardian is shared with {siblings.length === 1 ? "another child" : `${siblings.length} other children`}.
                Saving changes their details too:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {siblings.map((child) => (
                  <li key={child.id}>
                    {child.studentName} <span className="font-mono">{child.admissionNumber}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
      )}
      <FormButtons pending={pending} onCancel={() => onDone(null)} />
    </form>
  )
}
