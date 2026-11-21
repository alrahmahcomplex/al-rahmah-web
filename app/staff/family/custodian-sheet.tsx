"use client"

import { useId, useState } from "react"

import { PersonNameBoxes, type PersonName } from "@/components/guided-form/names"
import { Button, ChoiceTiles, Field, FieldError, Sheet, toast } from "@/components/kit"
import type { Relationship } from "@/lib/services/leads"

import { correctContact } from "../applicants/[id]/actions"
import type { CorrectionOutcome } from "../applicants/[id]/correction-outcome"
import { personParts } from "../check-in/[id]/model"
import { LOST, useSheetSave } from "./saving"

// Change the custodian (#512, prototype v54): their name, relationship to the
// students and mobile numbers, through the record's own contact correction.
// The relationship is kept on each child (#312), so the sheet saves it once
// for each student on this page who sits on the custodian. When the father
// is the custodian, only his numbers change here: his name is the father's.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const RELATIONSHIPS = ["Mother", "Guardian", "Other"] as const

export type CustodianView = {
  contactId: string
  fullName: string
  phone: string
  whatsapp: string | null
  // The students on the page on this custodian, each with its own relationship.
  members: { leadId: string; relationship: Relationship; relationshipDescription: string | null }[]
  // Every lead on the custodian, for the correction's check.
  children: string[]
}

const digits = (value: string) => value.replace(/\D/g, "")
const cleanPart = (part: string) => part.trim().replace(/\s+/g, " ").toUpperCase()
const same = (a: string, b: string) => cleanPart(a) === cleanPart(b)

export function CustodianSheet({ custodian, open, onOpenChange }: { custodian: CustodianView; open: boolean; onOpenChange: (open: boolean) => void }) {
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

  function reset() {
    setName(personParts(custodian.fullName))
    setRelationship(first.relationship)
    setDescription(first.relationshipDescription ?? "")
    setPhone(custodian.phone)
    setWhatsapp(custodian.whatsapp ?? "")
    setProblem(null)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const parts = [name.firstName, name.middleName, name.lastName].map(cleanPart)
    const fullName = parts.filter(Boolean).join(" ")
    // A name kept as it is saves as it is, however many names it has.
    if (!father && !same(fullName, custodian.fullName) && parts.some((p) => p === "")) {
      return setProblem("Type all three of the custodian’s names.")
    }
    if (shared && !father && relationship === "Other" && description.trim() === "") return setProblem("Say how they are related to the students.")
    if (digits(phone).length < 10) return setProblem("Type the mobile number in full, for example 0712 345 678.")
    if (whatsapp.trim() && digits(whatsapp).length < 10) return setProblem("Type the WhatsApp number in full, or leave it empty.")

    const contact = {
      fullName: father || same(fullName, custodian.fullName) ? custodian.fullName : fullName,
      phone: phone.trim(),
      whatsapp: whatsapp.trim() === "" ? null : whatsapp.trim(),
    }
    run(
      async () => {
        // The first save changes the custodian; each later one only its student's relationship.
        for (const m of custodian.members) {
          const rel = shared ? relationship : m.relationship
          const desc = shared ? (relationship === "Other" ? description.trim() : null) : m.relationshipDescription
          let outcome: CorrectionOutcome
          try {
            outcome = await correctContact(custodian.contactId, { ...contact, relationship: rel, relationshipDescription: desc }, custodian.children, m.leadId)
          } catch {
            outcome = { status: "refused", field: null, message: LOST }
          }
          if (outcome.status !== "saved") return outcome
        }
        return { status: "saved" }
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
      onOpenChange={(next) => {
        if (pending) return
        if (next) reset()
        onOpenChange(next)
      }}
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
        <FieldError id={`${id}-error`} message={problem ?? undefined} />
      </form>
    </Sheet>
  )
}
