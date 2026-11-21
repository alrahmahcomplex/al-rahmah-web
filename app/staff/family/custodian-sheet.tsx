"use client"

import { useId, useState } from "react"

import { PersonNameBoxes, type PersonName } from "@/components/guided-form/names"
import { Button, ChoiceTiles, Field, FieldError, Note, Sheet, toast } from "@/components/kit"
import type { ContactChanges, Relationship } from "@/lib/services/leads"

import { correctContact } from "../applicants/[id]/actions"
import type { CorrectionOutcome } from "../applicants/[id]/correction-outcome"
import { personParts } from "../check-in/[id]/model"
import { LOST, useSheetSave } from "./saving"

// Change the custodian (#512, prototype v54): their name, relationship to the
// students and mobile numbers, in one save through the record's own contact
// correction. Only what changed is sent, so the sheet never puts back a value
// someone else changed since the page was read.
//
// The relationship is kept on each child (#312). The correction changes it on
// the child named and on every child of this custodian that held the same
// one, as the record does, so it is offered only when the students here all
// hold one relationship. Like the record, the sheet names the custodian's
// other children, outside this page, that the save also reaches. When the
// father is the custodian, only his numbers change here (prototype v54).
//
// The card mounts the sheet afresh for each Change, so it starts from the
// custodian as they are now.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const RELATIONSHIPS = ["Mother", "Guardian", "Other"] as const

export type CustodianView = {
  contactId: string
  fullName: string
  phone: string
  whatsapp: string | null
  // The students on the page on this custodian, each with its own relationship.
  members: { leadId: string; relationship: Relationship; relationshipDescription: string | null }[]
  // Every lead on the custodian, closed ones too.
  children: { id: string; studentName: string; admissionNumber: string }[]
}

const digits = (value: string) => value.replace(/\D/g, "")
const cleanPart = (part: string) => part.trim().replace(/\s+/g, " ").toUpperCase()
const same = (a: string, b: string) => cleanPart(a) === cleanPart(b)

export function CustodianSheet({ custodian: shown, open, onOpenChange }: { custodian: CustodianView; open: boolean; onOpenChange: (open: boolean) => void }) {
  // The custodian as they were when Change opened it. A page refresh while the sheet is open (another
  // card's save) must not turn a field left alone into a write, or change the children the save expects.
  const [custodian] = useState(shown)
  const first = custodian.members[0]
  // One relationship for every student here, or the students hold different ones and keep them.
  const shared = custodian.members.every(
    (m) => m.relationship === first.relationship && (m.relationshipDescription ?? "") === (first.relationshipDescription ?? ""),
  )
  const father = shared && first.relationship === "Father"
  const [name, setName] = useState<PersonName>(() => personParts(custodian.fullName))
  const [relationship, setRelationship] = useState<Relationship>(first.relationship)
  const [description, setDescription] = useState(first.relationshipDescription ?? "")
  const [phone, setPhone] = useState(custodian.phone)
  const [whatsapp, setWhatsapp] = useState(custodian.whatsapp ?? "")
  const { problem, setProblem, pending, run } = useSheetSave()
  const id = useId()
  const onPage = new Set(custodian.members.map((m) => m.leadId))
  const others = custodian.children.filter((c) => !onPage.has(c.id))

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const parts = [name.firstName, name.middleName, name.lastName].map(cleanPart)
    const fullName = parts.filter(Boolean).join(" ")
    const nameChanged = !father && !same(fullName, custodian.fullName)
    // A name kept as it is saves as it is, however many names it has.
    if (nameChanged && parts.some((p) => p === "")) return setProblem("Type all three of the custodian’s names.")
    if (shared && !father && relationship === "Other" && description.trim() === "") return setProblem("Say how they are related to the students.")
    if (digits(phone).length < 10) return setProblem("Type the mobile number in full, for example 0712 345 678.")
    if (whatsapp.trim() && digits(whatsapp).length < 10) return setProblem("Type the WhatsApp number in full, or leave it empty.")

    const desc = relationship === "Other" ? description.trim() : null
    const changes: ContactChanges = {
      ...(nameChanged ? { fullName } : {}),
      ...(shared && !father && (relationship !== first.relationship || (desc ?? "") !== (first.relationshipDescription ?? ""))
        ? { relationship, relationshipDescription: desc }
        : {}),
      ...(phone.trim() !== custodian.phone ? { phone: phone.trim() } : {}),
      ...(whatsapp.trim() !== (custodian.whatsapp ?? "") ? { whatsapp: whatsapp.trim() === "" ? null : whatsapp.trim() } : {}),
    }
    if (Object.keys(changes).length === 0) {
      onOpenChange(false)
      toast("Nothing changed.")
      return
    }
    run(
      async (): Promise<CorrectionOutcome> => {
        try {
          return await correctContact(custodian.contactId, changes, custodian.children.map((c) => c.id), first.leadId)
        } catch {
          return { status: "refused", field: null, message: LOST }
        }
      },
      () => {
        onOpenChange(false)
        toast("Custodian saved.")
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      placement="centre"
      title="Change the custodian"
      hint={father ? `The father, ${custodian.fullName}, is the custodian.` : "Their name, relationship and mobile number."}
      closeLabel="Close"
      foot={
        <Button type="submit" form={`${id}-form`} size="wide" chevron pending={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="fam-form">
        <fieldset disabled={pending} className="fam-form m-0 min-w-0 border-0 p-0">
          {!father && (
            <PersonNameBoxes
              id={`${id}-name`}
              labels={NAME_LABELS}
              value={name}
              maxLength={60}
              onChange={(next) => {
                setName(next)
                setProblem(null)
              }}
            />
          )}
          {shared && !father && (
            <>
              <ChoiceTiles
                name={`${id}-rel`}
                layout="three"
                legend={<span className="fam-q">Relationship to the students</span>}
                options={RELATIONSHIPS.map((value) => ({ value, label: value }))}
                value={relationship}
                onChange={(value) => {
                  setRelationship(value as Relationship)
                  setProblem(null)
                }}
              />
              {relationship === "Other" && (
                <Field
                  placeholder="How are they related? For example: aunt"
                  aria-label="How they are related to the students"
                  autoComplete="off"
                  maxLength={60}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    setProblem(null)
                  }}
                />
              )}
            </>
          )}
          <Field
            icon="phone"
            type="tel"
            inputMode="tel"
            placeholder="Mobile number"
            aria-label="Mobile number"
            autoComplete="off"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
              setProblem(null)
            }}
          />
          <Field
            icon="phone"
            type="tel"
            inputMode="tel"
            placeholder="WhatsApp number, if different"
            aria-label="WhatsApp number, if different"
            autoComplete="off"
            value={whatsapp}
            onChange={(event) => {
              setWhatsapp(event.target.value)
              setProblem(null)
            }}
          />
        </fieldset>
        {others.length > 0 && (
          // The record's warning (lead-editors.tsx, ContactForm), for the children outside this page.
          <Note role="note" className="fam-left">
            <span className="block">
              This custodian is shared with {others.length === 1 ? "another child" : `${others.length} other children`}. Saving changes their
              details too:
            </span>
            {others.map((c) => (
              <span key={c.id} className="block">
                {c.studentName} <span className="kit-num">{c.admissionNumber}</span>
              </span>
            ))}
          </Note>
        )}
        <FieldError id={`${id}-error`} message={problem ?? undefined} />
      </form>
    </Sheet>
  )
}
