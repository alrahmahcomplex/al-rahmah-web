"use client"

import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { Button, ChoiceTiles, Field as KitField, Note, TextLink, type FieldProps } from "@/components/kit"
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
import { Select } from "./form-controls"
import { CardHeading } from "./lead-card"

// A field in a lead form: the kit's compact pill, left-aligned.
export function Input(props: FieldProps) {
  return <KitField size="compact" alignStart {...props} />
}

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
    <p role="status" className="lr-saved">
      {message}
    </p>
  )
}

export function Refusal({ refusal }: { refusal: Unsaved | null }) {
  if (!refusal) return null
  if (refusal.status === "duplicate") {
    return (
      <Note tone="bad" role="alert">
        This change would make the student a duplicate of{" "}
        <Link href={refusal.href} className="lr-num font-semibold underline">
          {refusal.admissionNumber}
        </Link>
        , which is already on file. Nothing was changed.
      </Note>
    )
  }
  return (
    <Note tone="bad" role="alert">
      {refusal.message}
    </Note>
  )
}

// A labelled field: the label over the control, then the hint. The control
// takes the id and the hint's id from `children`.
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
    <div className="lr-field">
      <label htmlFor={id} className="lr-label">
        {label}
      </label>
      {children({ id, describedBy: hint ? hintId : undefined, invalid: Boolean(invalid) })}
      {hint && (
        <p id={hintId} className="lr-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

// Save and Cancel under a form that opens in place in a card.
export function FormButtons({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <div className="lr-acts">
      <Button type="submit" size="small" pending={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button variant="ghost" size="small" onClick={onCancel} aria-disabled={pending || undefined}>
        Cancel
      </Button>
    </div>
  )
}

// The Student card: its details, and in their place the form to correct
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

  function done(message: string | null) {
    setEditing(null)
    setSaved(message)
  }

  return (
    <section aria-labelledby="lead-student" className="lr-card">
      <CardHeading
        id="lead-student"
        title="Student"
        action={editing === null && canEditDetails && <EditButton label="Edit student" onClick={() => open("details")} />}
      />
      {editing === "details" ? (
        <StudentDetailsForm lead={lead} years={years} onDone={done} />
      ) : editing === "visit" ? (
        <VisitDateForm lead={lead} today={today} onDone={done} />
      ) : (
        <>
          {children}
          {canCorrectVisit && (
            <div>
              <Button variant="ghost" size="small" onClick={() => open("visit")}>
                Correct Visit date
              </Button>
            </div>
          )}
          <Saved message={saved} />
        </>
      )}
    </section>
  )
}

// The one Edit in a card's heading. `label` names what it edits for screen
// readers and tests; the button shows "Edit".
export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <TextLink aria-label={label} onClick={onClick}>
      Edit
    </TextLink>
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
      className="lr-form"
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
          <Select
            id={id}
            value={className}
            onChange={(event) => setClassName(event.target.value as LeadClass)}
            aria-invalid={invalid || undefined}
          >
            {LEAD_CLASSES.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Enrollment year" invalid={invalid("enrollment_year")}>
        {({ id, invalid }) => (
          <Select
            id={id}
            value={enrollmentYear}
            onChange={(event) => setEnrollmentYear(event.target.value)}
            aria-invalid={invalid || undefined}
          >
            {yearChoices.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </Select>
        )}
      </Field>
      <ChoiceTiles
        name="day-or-boarding"
        legend={<span className="lr-label">Day or boarding</span>}
        layout="two"
        options={DAY_OR_BOARDING.map((choice) => ({ value: choice, label: choice }))}
        value={dayOrBoarding}
        onChange={(choice) => setDayOrBoarding(choice as DayOrBoarding)}
      />
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
      className="lr-form"
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

  return (
    <section aria-labelledby="lead-parent" className="lr-card">
      <CardHeading
        id="lead-parent"
        title="Parent or guardian"
        action={
          !editing &&
          canEdit && (
            <EditButton
              label="Edit parent or guardian"
              onClick={() => {
                setSaved(null)
                setEditing(true)
              }}
            />
          )
        }
      />
      {editing ? (
        <ContactForm
          lead={lead}
          siblings={siblings}
          onDone={(message) => {
            setEditing(false)
            setSaved(message)
          }}
        />
      ) : (
        <>
          {children}
          <Saved message={saved} />
        </>
      )}
    </section>
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
      className="lr-form"
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
          <Select
            id={id}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as Relationship)}
          >
            {RELATIONSHIPS.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </Select>
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
        <Note>
          <p className="m-0">
            This parent or guardian is shared with {siblings.length === 1 ? "another child" : `${siblings.length} other children`}.
            Saving changes their details too:
          </p>
          <ul className="lr-bullets">
            {siblings.map((child) => (
              <li key={child.id}>
                {child.studentName} <span className="lr-num">{child.admissionNumber}</span>
              </li>
            ))}
          </ul>
        </Note>
      )}
      <FormButtons pending={pending} onCancel={() => onDone(null)} />
    </form>
  )
}
