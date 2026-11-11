"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"

import {
  Button,
  Card,
  ChipButtons,
  ChoiceTiles,
  Field,
  FieldError,
  InlineEditor,
  KeyValueList,
  ListRow,
  Note,
  Popover,
  PopoverClose,
  rainConfetti,
  RoundButton,
  Section,
  Sheet,
  StatusChip,
  Table,
  Tag,
  TextLink,
  toast,
} from "@/components/kit"

import {
  DISCOUNT_REQUESTS,
  FEE_CHOICES,
  FEE_REASONS,
  feeFor,
  NEW_REQUESTS,
  NO_SCHOOL_ASKED,
  PAYMENT_KINDS,
  REGIONS,
  SHEET_APPLICANTS,
  type SheetApplicant,
} from "./fixtures"

// The overlays on the kit page (#320): each card opens one, filled with the
// prototype's own screens and words (version 13). Nothing here is saved.

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`
const firstName = (name: string) => name.trim().split(/\s+/)[0]
const feeOf = (a: SheetApplicant) => feeFor(a.cls) * (1 - (a.share ?? 0))
const fatherOf = (a: SheetApplicant) => a.father ?? a.name.split(" ").slice(1).join(" ")

/** What a fee edit changes for the student and each sibling (prototype, `feeImpact`). */
function feeImpact(apps: SheetApplicant[], a: SheetApplicant, choice: string) {
  const current = a.share ?? 0
  const next = choice === "Full fee" ? 0 : choice === "Sibling 10%" ? 0.1 : (a.auto ?? current)
  const siblings = apps.filter((x) => x !== a && a.group && x.group === a.group)
  const open = siblings.filter((x) => x.status !== "Enrolled" && x.share).sort((p, q) => feeFor(q.cls) - feeFor(p.cls))
  // A full payer set to 10% by hand gives up the full-fee place to the dearest sibling not yet Enrolled.
  const heir = a.full && next && !siblings.some((x) => x.status === "Enrolled" && !x.share) ? (open[0] ?? null) : null
  const lines = [
    next === current ? `${firstName(a.name)}: no change, ${tzs(feeOf(a))}.` : `${firstName(a.name)}: ${tzs(feeOf(a))} becomes ${tzs(feeFor(a.cls) * (1 - next))}.`,
    ...siblings.map((x) => (x === heir ? `${firstName(x.name)}: ${tzs(feeOf(x))} becomes ${tzs(feeFor(x.cls))}, as the new full payer.` : `${firstName(x.name)}: no change.`)),
  ]
  if (!siblings.length) lines.push("No sibling’s fee changes.")
  return { next, current, heir, lines }
}

/** The centre sheet: the Admissions Manager reviews a discount request. */
function DiscountReviews() {
  const [decided, setDecided] = useState<Record<string, "Granted" | "Refused">>({})
  const [review, setReview] = useState({ index: 0, open: false })
  const request = DISCOUNT_REQUESTS[review.index]

  function decide(result: "Granted" | "Refused") {
    setDecided((d) => ({ ...d, [request.name]: result }))
    setReview((r) => ({ ...r, open: false }))
    toast(`${result} for ${request.name}. The desk can see it now.`)
  }

  return (
    <Card title="Sheet" className="kp-full">
      {DISCOUNT_REQUESTS.map((d, i) => {
        const result = decided[d.name]
        return (
          <ListRow
            key={d.name}
            icon="discounts"
            title={`${d.name} · ${d.kind}`}
            caption={`${d.why} · ${d.by}`}
            trailing={
              <>
                <Tag tone={result === "Granted" ? "ok" : result === "Refused" ? "bad" : "wait"}>{result ?? "Waiting"}</Tag>
                {!result && (
                  <Button variant="ghost" size="small" onClick={() => setReview({ index: i, open: true })}>
                    Review
                  </Button>
                )}
              </>
            }
          />
        )
      })}
      <Sheet
        open={review.open}
        onOpenChange={(open) => setReview((r) => ({ ...r, open }))}
        title={request.kind}
        hint={request.name}
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" chevron onClick={() => decide("Granted")}>
              Grant the discount
            </Button>
            <Button variant="ghost" size="wide" onClick={() => decide("Refused")}>
              Refuse
            </Button>
          </>
        }
      >
        <Note tone="wait">
          <b>{request.why}.</b> {request.detail}
        </Note>
        <Note>Proof noted at the desk: {request.proof}</Note>
      </Sheet>
    </Card>
  )
}

function FatherEditor({ value, onSave, onCancel }: { value: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(value)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()
  return (
    <InlineEditor
      saveLabel="Save"
      cancelLabel="Cancel"
      onCancel={onCancel}
      onSave={() => {
        const v = name.trim().replace(/\s+/g, " ")
        if (v.split(" ").length < 2) {
          setError("Type the full name, at least two names.")
          input.current?.focus()
          return
        }
        onSave(v)
      }}
    >
      <Field
        ref={input}
        size="compact"
        autoFocus
        autoComplete="off"
        placeholder="Father’s full name"
        aria-label="Father’s full name"
        value={name}
        invalid={!!error}
        aria-describedby={errorId}
        onChange={(e) => {
          setName(e.target.value)
          setError(undefined)
        }}
      />
      <FieldError id={errorId} message={error} />
    </InlineEditor>
  )
}

function SchoolEditor({ onSave, onCancel }: { onSave: (school: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("")
  const [type, setType] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [region, setRegion] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()

  const q = query.trim().toLowerCase()
  const found = (q ? REGIONS.filter((r) => r.toLowerCase().includes(q)) : REGIONS).slice(0, 6)
  if (region && !found.includes(region)) found.unshift(region)

  return (
    <InlineEditor
      saveLabel="Save"
      cancelLabel="Cancel"
      onCancel={onCancel}
      onSave={() => {
        const v = name.trim().replace(/\s+/g, " ")
        if (v.length < 3) {
          setError("Type the school’s name.")
          input.current?.focus()
          return
        }
        if (!type || !region) return setError("Choose private or public, and the region.")
        onSave(`${v} · ${type} · ${region}`)
      }}
    >
      <Field
        ref={input}
        size="compact"
        autoFocus
        autoComplete="off"
        placeholder="School name"
        aria-label="School name"
        value={name}
        invalid={!!error}
        aria-describedby={errorId}
        onChange={(e) => {
          setName(e.target.value)
          setError(undefined)
        }}
      />
      <ChoiceTiles
        name="kp-school-type"
        layout="two"
        legend={null}
        options={["Private", "Public"].map((t) => ({ value: t, label: t }))}
        value={type}
        onChange={(t) => {
          setType(t)
          setError(undefined)
        }}
      />
      <Field
        size="compact"
        autoComplete="off"
        placeholder="Type to find a region"
        aria-label="Find a region"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setError(undefined)
        }}
      />
      {found.length ? (
        <ChipButtons
          label="Find a region"
          options={found.map((r) => ({ value: r, label: r }))}
          value={region}
          onChange={(r) => {
            setRegion(r)
            setError(undefined)
          }}
        />
      ) : (
        <p className="kit-sheet-hint">No region by that name.</p>
      )}
      <FieldError id={errorId} message={error} />
    </InlineEditor>
  )
}

function FeeEditor({ apps, a, onSave, onCancel }: { apps: SheetApplicant[]; a: SheetApplicant; onSave: (choice: string, reason: string, note: string) => void; onCancel: () => void }) {
  const [choice, setChoice] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string>()
  const errorId = useId()
  const impact = choice ? feeImpact(apps, a, choice) : null

  return (
    <InlineEditor
      saveLabel="Save the fee"
      cancelLabel="Cancel"
      onCancel={onCancel}
      onSave={() => {
        if (!choice || !impact) return setError("Choose the fee.")
        if (impact.next === impact.current && !impact.heir && !(choice === "Back to automatic" && a.edited)) return setError("Nothing would change.")
        if (!reason) return setError("Choose the reason.")
        onSave(choice, reason, note.trim().replace(/\s+/g, " "))
      }}
    >
      <ChoiceTiles
        name="kp-fee"
        layout="three"
        legend={null}
        options={FEE_CHOICES.map((c) => ({ value: c, label: c }))}
        value={choice}
        onChange={(c) => {
          setChoice(c)
          setError(undefined)
        }}
      />
      {impact && (
        <Note>
          <b>Before you save</b>
          {impact.lines.map((line) => (
            <span key={line}>
              <br />
              {line}
            </span>
          ))}
        </Note>
      )}
      <p className="kit-sheet-hint">Reason for the change</p>
      <ChipButtons
        label="Reason for the change"
        options={FEE_REASONS.map((r) => ({ value: r, label: r }))}
        value={reason}
        onChange={(r) => {
          setReason(r)
          setError(undefined)
        }}
      />
      <Field size="compact" autoComplete="off" placeholder="Note (optional)" aria-label="Note, optional" value={note} onChange={(e) => setNote(e.target.value)} />
      <FieldError id={errorId} message={error} />
    </InlineEditor>
  )
}

type Editing = "father" | "school" | "fee" | null

/** The centre sheet with a field: recording a payment, then reviewing it. */
function PaymentSheet({ a, open, onOpenChange, onConfirm }: { a: SheetApplicant; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (kind: string, amount: number) => void }) {
  const [step, setStep] = useState<"form" | "review">("form")
  const [kind, setKind] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const formId = useId()
  const errorId = useId()

  const value = Number(amount.replace(/[,\s]/g, ""))
  const fee = feeOf(a)
  const paidAfter = (a.paid ?? 0) + value

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!kind) return setError("Choose the kind of payment.")
    if (!(value > 0) || value % 1) {
      setError("Type the amount in whole shillings, for example 600,000.")
      input.current?.focus()
      return
    }
    setStep("review")
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Record a payment"
      hint={`${a.name} · ${a.cls}`}
      closeLabel="Close"
      foot={
        step === "form" ? (
          <Button type="submit" form={formId} size="wide" chevron>
            Review payment
          </Button>
        ) : (
          <>
            <Button size="wide" chevron onClick={() => kind && onConfirm(kind, value)}>
              Confirm payment
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setStep("form")}>
              Change
            </Button>
          </>
        )
      }
    >
      <div className="kp-pay">
        {step === "form" ? (
          <form id={formId} noValidate onSubmit={submit}>
            <p className="kit-sheet-hint">What kind of payment is it?</p>
            <ChipButtons
              label="What kind of payment is it?"
              options={PAYMENT_KINDS.map((k) => ({ value: k, label: k }))}
              value={kind}
              onChange={(k) => {
                setKind(k)
                setError(undefined)
              }}
            />
            <Field
              ref={input}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Amount in TZS"
              aria-label="Amount in shillings"
              value={amount}
              invalid={!!error && !!kind}
              aria-describedby={errorId}
              onChange={(e) => {
                setAmount(e.target.value)
                setError(undefined)
              }}
            />
            <p className="kit-sheet-hint">Paid today, 11 November 2026.</p>
            <FieldError id={errorId} message={error} />
          </form>
        ) : (
          <>
            <KeyValueList
              items={[
                {
                  key: "Payment",
                  value: (
                    <>
                      {kind}, <span className="kit-num">{tzs(value)}</span>
                    </>
                  ),
                  reason: "Paid 11 November 2026",
                },
                { key: "School fee", value: tzs(fee), reason: a.reason ?? "Full fee", numeric: true },
                { key: "Total paid after", value: tzs(paidAfter), numeric: true },
                { key: "Balance after", value: tzs(Math.max(0, fee - paidAfter)), numeric: true },
                { key: "Status after", value: <StatusChip status="Enrolled" /> },
              ]}
            />
            <p className="kit-sheet-hint">Check this payment before you confirm it. Once recorded, it can’t be changed.</p>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** The side sheet: a row's record, with the inline editors and Record payment. */
function ApplicantSheets() {
  const [apps, setApps] = useState(SHEET_APPLICANTS)
  const [sheet, setSheet] = useState({ number: SHEET_APPLICANTS[0].number, open: false })
  const [editing, setEditing] = useState<Editing>(null)
  // Each payment starts afresh: a new round remounts the payment sheet.
  const [pay, setPay] = useState({ open: false, round: 0 })
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const a = apps.find((x) => x.number === sheet.number) ?? apps[0]
  const update = (changes: Partial<SheetApplicant>, others: Record<string, Partial<SheetApplicant>> = {}) =>
    setApps((list) => list.map((x) => (x.number === a.number ? { ...x, ...changes } : others[x.number] ? { ...x, ...others[x.number] } : x)))
  const close = () => setSheet((s) => ({ ...s, open: false }))

  const schoolValue = NO_SCHOOL_ASKED.includes(a.cls) ? (
    "Not asked below STD 2"
  ) : a.school === "not-known" ? (
    <>
      <Tag tone="wait">Not known yet</Tag> <TextLink onClick={() => setEditing("school")}>Add</TextLink>
    </>
  ) : (
    (a.school ?? "Not recorded yet")
  )

  return (
    <Card title="Side sheet" className="kp-full">
      <Table
        label="Applicants"
        rows={apps}
        rowKey={(x) => x.number}
        rowLabel={(x) => x.name}
        onOpen={(x) => {
          setEditing(null)
          setSheet({ number: x.number, open: true })
        }}
        columns={[
          {
            header: "Student",
            cell: (x) => (
              <>
                <b>{x.name}</b>
                <small>{x.number}</small>
              </>
            ),
          },
          { header: "Class", cell: (x) => x.cls },
          { header: "Custodian", cell: (x) => x.custodian },
          { header: "Status", cell: (x) => <StatusChip status={x.status} /> },
          { header: "Next step", cell: (x) => x.next },
        ]}
      />
      <Sheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        placement="side"
        title={a.name}
        chips={<StatusChip status={a.status} />}
        closeLabel="Close"
        foot={
          <>
            {a.fromForm && (
              <Button size="wide" chevron onClick={close}>
                Check in this family
              </Button>
            )}
            <Button variant="ghost" size="wide">
              Open full record
            </Button>
          </>
        }
      >
        <Section title="Student">
          <KeyValueList
            items={[
              { key: "Admission Number", value: a.number, numeric: true },
              { key: "Class", value: a.cls },
              {
                key: "Father’s full name",
                value: (
                  <>
                    {fatherOf(a)} <TextLink onClick={() => setEditing("father")}>Edit</TextLink>
                  </>
                ),
              },
              { key: "Previous school", value: schoolValue },
            ]}
          />
          {editing === "father" && (
            <FatherEditor
              key={a.number}
              value={fatherOf(a)}
              onCancel={() => setEditing(null)}
              onSave={(father) => {
                update({ father })
                setEditing(null)
                toast("Father’s name saved. The sibling check runs again.")
              }}
            />
          )}
          {editing === "school" && (
            <SchoolEditor
              key={a.number}
              onCancel={() => setEditing(null)}
              onSave={(school) => {
                update({ school })
                setEditing(null)
                toast("Previous school saved.")
              }}
            />
          )}
        </Section>
        <Section title="Custodian">
          <KeyValueList
            items={[
              { key: "Name", value: a.custodian },
              { key: "Relationship", value: a.relationship ?? "Not recorded yet" },
              { key: "Brought by", value: a.broughtBy ?? "Not recorded yet" },
            ]}
          />
        </Section>
        <Section title="Sibling group">
          <p>{a.sibling ?? "Not checked yet. The Admission form doesn’t ask for the father’s name."}</p>
        </Section>
        {!a.fromForm && a.status !== "Declined" && (
          <Section title="School fee">
            <KeyValueList
              items={[
                { key: "Fee this year", value: tzs(feeOf(a)), reason: `${a.reason ?? "Full fee"}${a.edited ? ` · ${a.edited}` : ""}`, numeric: true },
                { key: "Paid so far", value: tzs(a.paid ?? 0), numeric: true },
              ]}
            />
            <div className="kp-rowx kp-fee-act">
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  close()
                  timer.current = window.setTimeout(() => setPay((p) => ({ open: true, round: p.round + 1 })), 200)
                }}
              >
                Record payment
              </Button>
              <TextLink onClick={() => setEditing("fee")}>Edit fee</TextLink>
            </div>
            {editing === "fee" && (
              <FeeEditor
                key={a.number}
                apps={apps}
                a={a}
                onCancel={() => setEditing(null)}
                onSave={(choice, reason, note) => {
                  const impact = feeImpact(apps, a, choice)
                  const back = choice === "Back to automatic"
                  const others: Record<string, Partial<SheetApplicant>> = impact.heir ? { [impact.heir.number]: { share: 0, reason: "Full fee", full: true } } : {}
                  update(
                    {
                      share: impact.next,
                      reason: impact.next ? "Sibling 10%" : "Full fee",
                      auto: back ? undefined : (a.auto ?? impact.current),
                      edited: back ? undefined : `edited by the Accountant on 11 Nov · ${reason}${note ? ` · ${note}` : ""}`,
                      full: impact.heir ? false : a.full,
                    },
                    others,
                  )
                  setEditing(null)
                  toast("Fee saved. The change and its reason are in the audit log.")
                }}
              />
            )}
          </Section>
        )}
        {a.fromForm ? (
          <Note tone="wait" icon="info">
            Sent from the Admission form. Check-in fills in the missing answers.
          </Note>
        ) : (
          <Note>Next step: {a.next}.</Note>
        )}
      </Sheet>
      <PaymentSheet
        key={pay.round}
        a={a}
        open={pay.open}
        onOpenChange={(open) => setPay((p) => ({ ...p, open }))}
        onConfirm={(kind, amount) => {
          const enrols = a.status !== "Enrolled"
          update({ paid: (a.paid ?? 0) + amount, ...(enrols ? { status: "Enrolled", next: "Nothing to do" } : {}) })
          setPay((p) => ({ ...p, open: false }))
          toast(enrols ? `${kind} recorded. ${firstName(a.name)} is now Enrolled.` : `${kind} recorded.`)
        }}
      />
    </Card>
  )
}

/** The bell's list and the person's account menu, as the new top bar will hold them. */
function Popovers() {
  const [unread, setUnread] = useState<number>(NEW_REQUESTS.length)
  const [bellOpen, setBellOpen] = useState(false)
  return (
    <Card title="Popover">
      <div className="kp-rowx kp-topbar">
        <span className="kp-bellw">
          <Popover
            open={bellOpen}
            onOpenChange={(open) => {
              setBellOpen(open)
              if (open) setUnread(0)
            }}
            trigger={<RoundButton icon="bell" label="New requests" size={40} />}
            title="New requests"
            closeLabel="Close"
          >
            {NEW_REQUESTS.map((r) => (
              <ListRow key={r.title} icon={r.icon} title={r.title} caption={r.caption} onClick={() => setBellOpen(false)} />
            ))}
          </Popover>
          {unread > 0 && (
            <i className="kp-pip" aria-hidden="true">
              {unread}
            </i>
          )}
        </span>
        <Popover
          size="narrow"
          trigger={
            <button type="button" className="kp-me">
              <i aria-hidden="true">RM</i>
              <span>
                <b>Rehema M.</b>
                <small>Admissions Manager</small>
              </span>
            </button>
          }
          title="Rehema M."
          description="Admissions Manager"
          closeLabel="Close"
        >
          <PopoverClose render={<Button variant="ghost">Sign out</Button>} />
        </Popover>
      </div>
    </Card>
  )
}

/** The overlay cards of the kit page's second grid. */
export function OverlayCards() {
  return (
    <>
      <DiscountReviews />
      <ApplicantSheets />
      <Popovers />
      <Card title="Toast">
        <Button variant="ghost" size="small" style={{ alignSelf: "flex-start" }} onClick={() => toast("Fee saved. The change and its reason are in the audit log.")}>
          Play it
        </Button>
      </Card>
      <Card title="Confetti">
        <Button variant="ghost" size="small" style={{ alignSelf: "flex-start" }} onClick={rainConfetti}>
          Play it
        </Button>
      </Card>
    </>
  )
}
