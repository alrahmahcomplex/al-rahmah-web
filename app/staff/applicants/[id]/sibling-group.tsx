"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button, KeyValueList, LoadingState, Note, Sheet, Tag, toast } from "@/components/kit"
import type { SentenceLanguage } from "@/lib/sibling-sentences"
import type { SiblingMemberView } from "@/lib/sibling-group-view"

import { REFUSE_EFFECT, RefuseReason, useRefuseReason } from "./decide-discount"
import { TextArea } from "./form-controls"
import { decideSibling, previewGrant, sendSiblingRequest, type GrantPreviewView } from "./sibling-actions"
import type { PendingSiblingView, SiblingGroupView, SiblingPerson } from "./sibling-read"
import "./lead.css"

// The Sibling group on the lead record and in the Applicants side sheet
// (#310): each member with its fee chip and why, in English;
// the Sibling request waiting on the lead, or the button to send one; and
// the Admissions Manager's review. The prototype is
// https://claude.ai/artifact/P6NEbzyxA9JpdKjFzu6z6U.

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."

export function useRefreshed(onChanged?: () => void) {
  const router = useRouter()
  return () => (onChanged ? onChanged() : router.refresh())
}

/** "Juma’s father" beside "Salma’s father". */
export function Compare({ a, b }: { a: { label: string; name: string }; b: { label: string; name: string } }) {
  return (
    <div className="sg-cmp">
      {[a, b].map((x, i) => (
        <div key={i}>
          <small>{x.label}</small>
          <b>{x.name}</b>
        </div>
      ))}
    </div>
  )
}

function MemberRow({
  member,
  lang,
  linked,
  onOpen,
}: {
  member: SiblingMemberView
  lang: SentenceLanguage
  linked: boolean
  onOpen?: (member: SiblingMemberView) => void
}) {
  const chip = member.chip[lang]
  return (
    <li className="sg-m" data-here={member.here || undefined}>
      <div className="sg-top">
        {member.here || !linked ? (
          <b>{member.studentName}</b>
        ) : onOpen ? (
          <button type="button" className="sg-name" onClick={() => onOpen(member)}>
            {member.studentName}
          </button>
        ) : (
          <Link href={`/staff/applicants/${member.leadId}`} className="sg-name">
            {member.studentName}
          </Link>
        )}
        <Tag tone={chip.tone}>
          <span lang={lang}>{chip.text}</span>
        </Tag>
      </div>
      <small className="sg-meta">{member.meta}</small>
      <p className="sg-why" lang={lang}>
        {member.sentence[lang]}
      </p>
      {member.notes.map(({ note, text }) => (
        <p key={note} className="sg-note" data-tone={note === "fee_edit_needed" ? "wait" : undefined}>
          {note === "fee_edit_needed" && <b>Granted: fee edit needed. </b>}
          <span lang={lang}>{text[lang]}</span>
        </p>
      ))}
    </li>
  )
}

/**
 * The group card. `linkMembers` makes the other members' names open their
 * record. `onChanged` reloads whatever shows the card after a change; by
 * default the page refreshes.
 */
export function SiblingGroupCard({
  view,
  open,
  linkMembers = true,
  onChanged,
  headingId,
  inSheet = false,
  onOpenMember,
}: {
  view: SiblingGroupView
  // In the Applicants side sheet, as one of its sections.
  inSheet?: boolean
  // Opens another member in place of a link to its record.
  onOpenMember?: (member: SiblingMemberView) => void
  // False on a closed lead: read-only.
  open: boolean
  linkMembers?: boolean
  onChanged?: () => void
  headingId?: string
}) {
  // Staff read the sentences in English; the views keep their Kiswahili for later use.
  const lang: SentenceLanguage = "en"
  const [asking, setAsking] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const refreshed = useRefreshed(onChanged)
  const ownId = useId()
  const titleId = headingId ?? ownId

  return (
    <section aria-labelledby={titleId} className={inSheet ? "kit-sec sg" : "lr-card sg"}>
      <div className="sg-head">
        {inSheet ? (
          <h3 id={titleId} className="kit-sec-title">
            Sibling group
          </h3>
        ) : (
          <h2 id={titleId} className="kit-card-title">
            Sibling group
          </h2>
        )}
      </div>
      <ul className="sg-list">
        {view.members.map((member) => (
          <MemberRow key={member.leadId} member={member} lang={lang} linked={linkMembers} onOpen={onOpenMember} />
        ))}
      </ul>
      {view.pending ? (
        <>
          <Note tone="wait">
            <b>Sibling request waiting.</b> Sent by {view.pending.requestedBy} on {view.pending.requestedOn}. Reason: Fathers’ names don’t
            match.{view.canReview ? "" : " The Admissions Manager decides."}
          </Note>
          {view.canReview && (
            <div className="lr-acts">
              <Button variant="ghost" size="small" onClick={() => setReviewing(true)}>
                Review the request
              </Button>
            </div>
          )}
        </>
      ) : (
        open &&
        view.canRequest && (
          <div className="lr-acts">
            <Button variant="ghost" size="small" onClick={() => setAsking(true)}>
              Request the Sibling discount
            </Button>
          </div>
        )
      )}
      <SiblingRequestSheet
        open={asking}
        onOpenChange={setAsking}
        leadId={view.leadId}
        studentName={view.studentName}
        father={view.father}
        sibling={view.compareWith}
        enrolled={view.enrolled}
        onSent={refreshed}
      />
      {view.pending && view.canReview && (
        <SiblingReviewSheet
          open={reviewing}
          onOpenChange={setReviewing}
          leadId={view.leadId}
          studentName={view.studentName}
          father={view.father}
          canGrant={open}
          pending={view.pending}
          onDone={refreshed}
        />
      )}
    </section>
  )
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** Sends a Sibling request from the record, an Enrolled student's too, with the proof the family will bring. */
export function SiblingRequestSheet({
  open,
  onOpenChange,
  leadId,
  studentName,
  father,
  sibling,
  enrolled,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  studentName: string
  father: string | null
  sibling: SiblingPerson | null
  enrolled: boolean
  onSent: () => void
}) {
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const formId = useId()
  const noteId = useId()
  const errorId = useId()

  // Each opening is a new request, with its own id for retries.
  const [shown, setShown] = useState(false)
  if (open !== shown) {
    setShown(open)
    if (open) {
      setError(null)
      setRequestId(crypto.randomUUID())
    }
  }

  function change(next: boolean) {
    if (pending) return
    onOpenChange(next)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (note.trim() === "") return setError("Write what proof the family will bring.")
    setError(null)
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof sendSiblingRequest>>
      try {
        outcome = await sendSiblingRequest(leadId, note, requestId)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setError(outcome.message)
      onOpenChange(false)
      setNote("")
      toast("Request sent to the Admissions Manager. Reason: fathers’ names don’t match.")
      onSent()
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      placement="side"
      title="Request the Sibling discount"
      hint={studentName}
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={formId} size="wide" chevron pending={pending}>
            {pending ? "Sending…" : "Send the request"}
          </Button>
          <Button variant="ghost" size="wide" onClick={() => change(false)} aria-disabled={pending || undefined}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="sg-col">
        {sibling && (
          <Compare
            a={{ label: `${firstOf(studentName)}’s father`, name: father ?? "Not recorded" }}
            b={{ label: `${sibling.firstName}’s father`, name: sibling.father ?? "Not recorded" }}
          />
        )}
        <KeyValueList
          items={[
            { key: "Reason", value: "Fathers’ names don’t match" },
            { key: "Goes to", value: "The Admissions Manager" },
          ]}
        />
        {enrolled && (
          <Note tone="wait">
            {firstOf(studentName)} is Enrolled, so the fee stays as it is. If the request is granted, staff who record payments can apply the
            10%.
          </Note>
        )}
        <Note>
          Ask the family to bring proof. If the children share only their mother and she has full custody, ask for both birth certificates. The
          mother’s name must match on both.
        </Note>
        <form id={formId} noValidate onSubmit={submit} className="lr-field">
          <label htmlFor={noteId} className="lr-label">
            What proof will the family bring?
          </label>
          <TextArea
            id={noteId}
            value={note}
            maxLength={1000}
            placeholder="For example: both birth certificates on Thursday"
            onChange={(event) => {
              setNote(event.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} role="alert" className="lr-error">
              {error}
            </p>
          )}
        </form>
      </div>
    </Sheet>
  )
}

/**
 * The Admissions Manager's review of a Sibling request: the two fathers'
 * names, who asked and when, the proof noted at the desk, and the group as a
 * grant would leave it. Grant, or Refuse with a reason in the same sheet.
 */
export function SiblingReviewSheet({
  open,
  onOpenChange,
  leadId,
  studentName,
  father,
  canGrant,
  pending: request,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  studentName: string
  father: string | null
  canGrant: boolean
  pending: PendingSiblingView
  onDone: () => void
}) {
  const [refusing, setRefusing] = useState(false)
  const [preview, setPreview] = useState<GrantPreviewView | { status: "refused"; message: string } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const why = useRefuseReason()
  const formId = useId()
  const refuseRef = useRef<HTMLButtonElement>(null)

  // The sheet starts at the request each time it opens, whoever opens it.
  const [shown, setShown] = useState(false)
  if (open !== shown) {
    setShown(open)
    if (open) {
      setRefusing(false)
      setFailed(null)
      setPreview(null)
      why.clearMissing()
    }
  }

  // What a grant would change, read each time the sheet opens.
  useEffect(() => {
    if (!open) return
    let gone = false
    previewGrant(request.requestId, leadId).then(
      (answer) => !gone && setPreview(answer),
      () => !gone && setPreview({ status: "refused", message: "What a grant would change could not be worked out. Try again in a moment." }),
    )
    return () => {
      gone = true
    }
  }, [open, request.requestId, leadId])

  function change(next: boolean) {
    if (busy) return
    onOpenChange(next)
  }

  function decide(decision: "grant" | "refuse") {
    setFailed(null)
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof decideSibling>>
      try {
        outcome = await decideSibling(leadId, request.requestId, decision, decision === "refuse" ? why.reason : null)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setFailed(outcome.message)
      onOpenChange(false)
      why.reset()
      toast(decision === "grant" ? `Granted for ${studentName}. The desk can see it now.` : `Refused for ${studentName}. The desk can see it now.`, {
        tone: decision === "grant" ? "good" : undefined,
      })
      onDone()
    })
  }

  const sibling = request.sibling ?? (preview?.status === "ready" ? preview.compareWith : null)
  const failure = failed && (
    <Note tone="bad" role="alert">
      {failed}
    </Note>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      placement="side"
      title="Sibling · 10%"
      hint={studentName}
      closeLabel="Close"
      foot={
        refusing ? (
          <>
            <Button type="submit" form={formId} variant="bad" size="wide" pending={busy}>
              {busy ? "Refusing…" : "Refuse request"}
            </Button>
            <Button
              variant="ghost"
              size="wide"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return
                setRefusing(false)
                setFailed(null)
                why.clearMissing()
                requestAnimationFrame(() => refuseRef.current?.focus())
              }}
            >
              Back
            </Button>
          </>
        ) : (
          <>
            {canGrant && (
              <Button
                size="wide"
                chevron
                pending={busy}
                // The grant waits until the Manager has seen what it changes.
                aria-disabled={preview?.status !== "ready" || undefined}
                onClick={() => preview?.status === "ready" && decide("grant")}
              >
                {busy ? "Granting…" : "Grant discount"}
              </Button>
            )}
            <Button
              ref={refuseRef}
              variant="bad"
              size="wide"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return
                setFailed(null)
                setRefusing(true)
              }}
            >
              Refuse request
            </Button>
          </>
        )
      }
    >
      {refusing ? (
        <form
          id={formId}
          noValidate
          className="sg-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (why.check()) decide("refuse")
          }}
        >
          <RefuseReason reason={why.reason} missing={why.missing} onChange={why.change} autoFocus />
          <p className="lr-hint">{REFUSE_EFFECT}</p>
          {failure}
        </form>
      ) : (
        <div className="sg-col">
          <Note tone="wait">
            <b>Fathers’ names don’t match.</b> Sibling of {sibling ? sibling.studentName : "a student in the group"}.
          </Note>
          {sibling && (
            <Compare
              a={{ label: `${firstOf(studentName)}’s father`, name: father ?? "Not recorded" }}
              b={{ label: `${sibling.firstName}’s father`, name: sibling.father ?? "Not recorded" }}
            />
          )}
          <KeyValueList
            items={[
              { key: "Asked by", value: `${request.requestedBy} · ${request.requestedOn}` },
              { key: "Waiting", value: request.waitingDays === 0 ? "Since today" : `${request.waitingDays} ${request.waitingDays === 1 ? "day" : "days"}` },
            ]}
          />
          <Note>Proof noted at the desk: {request.note}</Note>
          {!canGrant && <Note>This application is closed. It can be granted only after it is reopened.</Note>}
          {canGrant && !(preview?.status === "ready" && preview.members === null && preview.changes === null) && (
            <div className="sg-part">
              <h4 className="lr-sub">If you grant it</h4>
              {preview === null ? (
                <LoadingState label="Working out what a grant changes…" />
              ) : preview.status === "refused" ? (
                <Note tone="bad" role="alert">
                  {preview.message}
                </Note>
              ) : (
                <>
                  {preview.members && (
                    <ul className="sg-pv">
                      {preview.members.map((m) => (
                        <li key={m.leadId}>
                          <b>{m.firstName}</b>
                          <Tag tone={m.chip.en.tone}>{m.chip.en.text}</Tag>
                          <small>
                            {m.sentence.en}
                            {m.feeEditNeeded ? " Shows Granted: fee edit needed." : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.changes !== null && (
                    <p className="lr-hint">{preview.changes.length > 0 ? preview.changes.join(" ") : "No fee changes."}</p>
                  )}
                </>
              )}
            </div>
          )}
          {failure}
        </div>
      )}
    </Sheet>
  )
}
