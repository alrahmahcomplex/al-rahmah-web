"use client"

import Link from "next/link"
import { useId, useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

import type { CorrectionOutcome } from "../../leads/[id]/correction-outcome"
import { findFamily, registerWalkIn, updateSharedContact } from "../actions"
import { childHref, compareContact, relationshipLabel } from "../family"
import type { RegisterOutcome } from "../outcome"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const LOST_REQUEST_MESSAGE =
  "The registration could not be confirmed. Check your connection and register again. If the student comes back as already registered, the first attempt was saved."

const LOST_LOOKUP_MESSAGE = "The check for a known family could not be completed. Check your connection and try again."

const LOST_UPDATE_MESSAGE =
  "The update could not be confirmed. Check your connection and try again, or keep the stored details."

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
}

// A refusal shown at the top of a screen, and the field it is about.
type Notice = { screen: Screen; field: InvalidField | null; message: string }

export function NewStudentForm({ today, years, canEditContact }: { today: string; years: number[]; canEditContact: boolean }) {
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
  })
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
        setNotice({ screen: "parent", field: null, message: LOST_LOOKUP_MESSAGE })
        return
      }
      if (result.status === "refused") {
        goTo("parent", { screen: "parent", field: result.field, message: result.message })
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
            children: confirmed.children.map((child) => child.id),
          })
        } catch {
          result = { status: "refused", field: null, message: LOST_UPDATE_MESSAGE }
        }
        if (result.status === "saved") {
          const typed = typedParent(details, match)
          const updated: FamilyContact = {
            ...confirmed,
            fullName: typed.fullName,
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
            ? { contactId: confirmed.id }
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

  if (created) {
    return <Confirmation admissionNumber={created.admissionNumber} leadId={created.leadId} studentName={details.studentName} />
  }

  const steps: Screen[] = known ? ["parent", "family", "student", "review"] : ["parent", "student", "review"]
  const stepNumber = steps.indexOf(screen === "compare" ? "family" : screen) + 1
  const title =
    screen === "parent"
      ? "Parent or guardian"
      : screen === "family"
        ? confirmed
          ? `${confirmed.fullName}'s family`
          : "Is this the same parent?"
        : screen === "compare"
          ? "Update the shared contact?"
          : screen === "student"
            ? "Student"
            : "Review"
  const field = notice?.screen === screen ? notice.field : null

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Step {stepNumber} of {steps.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">
          {title}
        </h2>
      </div>

      {notice?.screen === screen && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{notice.message}</AlertDescription>
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
          onBack={() => goTo(known ? "family" : "parent")}
          onNext={() => goTo("review")}
        />
      )}
      {screen === "review" && (
        <ReviewStep
          details={details}
          contact={confirmed}
          pending={pending}
          duplicate={duplicate}
          onBack={() => {
            setDuplicate(null)
            goTo("student")
          }}
          onSubmit={submit}
        />
      )}
    </div>
  )
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

function ParentStep({ details, set, field, pending, onNext }: StepProps & { pending: boolean; onNext: () => void }) {
  const phoneError = field === "phone" ? "Check this number." : null
  const whatsappError = field === "whatsapp" ? "Check this number." : null

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Cancel</Link>
      </div>
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
      <p className="text-sm text-slate-700">
        {several
          ? `This number is on file for ${match.contacts.length} parents or guardians. Check the name and relationship with the parent, and choose the one they are, or Not the same person if none fits.`
          : "This number is already on file. Check the name and relationship with the parent."}
      </p>
      <ul className="flex flex-col gap-3">
        {match.contacts.map((contact) => (
          <li key={contact.id}>
            <ContactCard contact={contact} onSame={() => onSame(contact)} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onNotSame}>
          Not the same person
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  )
}

function ContactCard({ contact, onSame }: { contact: FamilyContact; onSame: () => void }) {
  const nameId = useId()
  return (
    <div
      role="group"
      aria-labelledby={nameId}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p id={nameId} className="font-semibold break-words text-slate-900">
          {contact.fullName}
        </p>
        <p className="text-sm text-slate-700">{relationshipLabel(contact.relationship, contact.relationshipDescription)}</p>
        <p className="text-xs text-muted-foreground">{childCount(contact.children.length)}</p>
      </div>
      <Button type="button" onClick={onSame}>
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
      <p className="text-sm text-slate-700">
        If the student is listed, open them instead of registering again. If not, register a new sibling.
      </p>
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
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link
                        href={childHref(child)}
                        aria-label={closed ? `Reopening request for ${child.studentName}` : `Open ${child.studentName}`}
                        className="font-medium text-blue-700 underline underline-offset-4"
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
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRegisterSibling}>
          Register a new sibling
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
      </div>
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
  const siblings = contact.children.map((child) => child.studentName)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">
        What you typed differs from the contact on file.
        {siblings.length > 0 && ` It is shared by ${siblings.join(", ")}, so updating it changes it for every one of them.`}
      </p>
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
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button
            type="button"
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
        <Button type="button" variant="outline" disabled={pending} onClick={onKeep}>
          Keep stored details
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
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
      className="flex max-w-xl flex-col gap-4"
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
  contact,
  pending,
  duplicate,
  onBack,
  onSubmit,
}: {
  details: Details
  // The confirmed contact the student joins, or null for a new one.
  contact: FamilyContact | null
  pending: boolean
  duplicate: Extract<RegisterOutcome, { status: "duplicate" }> | null
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
    <div className="flex max-w-xl flex-col gap-5">
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
        <Summary rows={parentRows} />
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
