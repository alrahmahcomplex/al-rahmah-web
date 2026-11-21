"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"

import { Button, ChoiceTiles, Note, Sheet, toast } from "@/components/kit"
import type { LastNameFrom } from "@/lib/names"

import { saveFatherName, type FatherOutcome } from "./sibling-actions"
import { Compare, SiblingRequestSheet, useRefreshed } from "./sibling-group"
import type { SiblingPerson } from "./sibling-read"

// Saving a father's full name and what follows it (#310): a name close to a
// sibling's asks "One name, or two?" before anything is saved; one that no
// longer matches says what changed and offers the Sibling request. The lead
// record's Father row and the Family page's name sheet (#512) both save
// through this, so both ask the same questions.

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."
const PICK_MS = 240

const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name

type Flow =
  | { kind: "question"; name: string; sibling: SiblingPerson; holders: string[] }
  | { kind: "different"; father: string; sibling: SiblingPerson | null; sentence: string; moves: string[] }
  | { kind: "same-now"; father: string; sibling: SiblingPerson; pending: boolean }
  | { kind: "request"; sibling: SiblingPerson | null; father: string | null }

type Answer = "typo-mine" | "typo-theirs" | "different"

export type FatherSaved = {
  // The father's full name now on the record: the one sent, or the sibling's
  // spelling when the desk said the sibling's was right.
  father: string
  // The toast for a plain save. Null when a sheet opens to say what changed.
  message: string | null
  // When the desk chose the sibling's spelling: that sibling's own name and last-name choice, which show how the father's name splits.
  siblingStudentName?: string
  siblingLastNameFrom?: LastNameFrom | null
}

export function useFatherNameFlow({
  leadId,
  studentName,
  father,
  enrolled,
  compareWith,
  onChanged,
  onSaved,
  onRefused,
  onAsk,
}: {
  leadId: string
  studentName: string
  // The name on the record before the change.
  father: string | null
  enrolled: boolean
  // The sibling a request compares with, for the request after a change.
  compareWith: SiblingPerson | null
  // Replaces the page refresh after a save.
  onChanged?: () => void
  // The name was saved. The caller closes its form and shows `message`.
  onSaved: (saved: FatherSaved) => void
  // Nothing was saved; the form shows why.
  onRefused: (message: string) => void
  // "One name, or two?" opens: nothing is saved until it is answered.
  onAsk?: () => void
}): {
  send: (name: string) => void
  pending: boolean
  sheets: ReactNode
  // One of the flow's sheets is on screen.
  showing: boolean
} {
  const [flow, setFlow] = useState<Flow | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  // The answer to "One name, or two?": the first one picked wins, and it is
  // saved once, after the tile shows it.
  const [choice, setChoice] = useState<string | null>(null)
  const picked = useRef<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const [pending, startTransition] = useTransition()
  const refreshed = useRefreshed(onChanged)
  const first = firstOf(studentName)

  function openFlow(next: Flow) {
    setFlow(next)
    picked.current = null
    setChoice(null)
    setFlowOpen(true)
  }

  function handle(outcome: FatherOutcome, saved: string, siblingStudentName?: string, siblingLastNameFrom?: LastNameFrom | null) {
    switch (outcome.status) {
      case "refused":
        onRefused(outcome.message)
        return
      case "question":
        onAsk?.()
        openFlow({ kind: "question", name: outcome.fatherFullName, sibling: outcome.sibling, holders: outcome.holders })
        return
      case "saved":
        onSaved({ father: saved, message: outcome.message, siblingStudentName, siblingLastNameFrom })
        refreshed()
        return
      case "different":
        onSaved({ father: outcome.father, message: null })
        refreshed()
        openFlow({ kind: "different", father: outcome.father, sibling: outcome.sibling, sentence: outcome.sentence, moves: outcome.moves })
        return
      case "same-now":
        onSaved({ father: outcome.father, message: null })
        refreshed()
        openFlow({ kind: "same-now", father: outcome.father, sibling: outcome.sibling, pending: outcome.pending })
        return
      case "ask-request":
        onSaved({ father: saved, message: null })
        refreshed()
        openFlow({ kind: "request", sibling: flow?.kind === "question" ? flow.sibling : compareWith, father: flow?.kind === "question" ? flow.name : father })
        return
    }
  }

  function save(name: string, answer: Answer | null, siblingFather: string | null) {
    startTransition(async () => {
      let outcome: FatherOutcome
      try {
        outcome = await saveFatherName(leadId, name, answer, siblingFather)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      const theirs = answer === "typo-theirs" && siblingFather
      const sibling = theirs && flow?.kind === "question" ? flow.sibling : null
      handle(outcome, theirs ? siblingFather : name, sibling?.studentName, sibling?.lastNameFrom)
    })
  }

  const sheets = (
    <>
      {flow?.kind === "question" && (
        <Sheet
          open={flowOpen}
          onOpenChange={(next) => {
            // Once an answer is picked it is saved: the sheet waits for it.
            if (pending || picked.current !== null) return
            setFlowOpen(next)
            if (!next && picked.current === null) toast("Nothing saved. The father’s name is as it was.")
          }}
          placement="side"
          title="One name, or two?"
          hint={`${studentName} · father’s name`}
          closeLabel="Close"
        >
          <div className="sg-col">
            <Compare
              a={{ label: `${first}’s father`, name: flow.name }}
              b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
            />
            <p className="sg-lead">Is it one name with a typing mistake, or two different names?</p>
            <ChoiceTiles
              name={`${leadId}-typo`}
              legend={<span className="sr-only">One name, or two?</span>}
              options={[
                {
                  value: "typo-mine",
                  label: "A typing mistake",
                  description: `The right name is ${flow.name}. It is saved on ${[first, ...flow.holders].length > 1 ? `${[first, ...flow.holders].slice(0, -1).join(", ")} and ${[first, ...flow.holders].slice(-1)[0]}` : first}’s records.`,
                },
                {
                  value: "typo-theirs",
                  label: "A typing mistake",
                  description: `The right name is ${flow.sibling.father}. ${first}’s name stays as it was.`,
                },
                { value: "different", label: "Two different names", description: "Send a Sibling request to the Admissions Manager" },
              ]}
              value={choice}
              onChange={(value) => {
                if (pending || picked.current !== null) return
                picked.current = value
                setChoice(value)
                timer.current = window.setTimeout(() => {
                  timer.current = null
                  setFlowOpen(false)
                  save(flow.name, value as Answer, flow.sibling.father)
                }, PICK_MS)
              }}
            />
          </div>
        </Sheet>
      )}

      {flow?.kind === "different" && (
        <Sheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          placement="side"
          title="The fathers’ names don’t match now"
          hint={`${studentName} · father’s name saved`}
          closeLabel="Close"
          foot={
            <>
              <Button size="wide" chevron onClick={() => setFlow({ kind: "request", sibling: flow.sibling, father: flow.father })}>
                Request the Sibling discount
              </Button>
              <Button variant="ghost" size="wide" onClick={() => setFlowOpen(false)}>
                Not now
              </Button>
            </>
          }
        >
          <div className="sg-col">
            {flow.sibling && (
              <Compare
                a={{ label: `${first}’s father`, name: flow.father }}
                b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
              />
            )}
            {flow.sentence && <Note tone="wait">{flow.sentence}</Note>}
            {flow.moves.length > 0 && (
              <Note>
                <b>Fees that changed</b>
                {flow.moves.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </Note>
            )}
          </div>
        </Sheet>
      )}

      {flow?.kind === "same-now" && (
        <Sheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          placement="side"
          title="The fathers’ names match now"
          hint={`${studentName} · father’s name saved`}
          closeLabel="Close"
          foot={
            flow.pending ? (
              <Button size="wide" onClick={() => setFlowOpen(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button size="wide" chevron onClick={() => setFlow({ kind: "request", sibling: flow.sibling, father: flow.father })}>
                  Request the Sibling discount
                </Button>
                <Button variant="ghost" size="wide" onClick={() => setFlowOpen(false)}>
                  Not now
                </Button>
              </>
            )
          }
        >
          <div className="sg-col">
            <Compare
              a={{ label: `${first}’s father`, name: flow.father }}
              b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
            />
            <Note>
              {flow.pending
                ? "The Sibling request stays open. The Admissions Manager decides."
                : "A name changed from a different one still needs the Admissions Manager’s decision."}
            </Note>
          </div>
        </Sheet>
      )}

      {flow?.kind === "request" && (
        <SiblingRequestSheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          leadId={leadId}
          studentName={studentName}
          father={flow.father}
          sibling={flow.sibling}
          enrolled={enrolled}
          onSent={refreshed}
        />
      )}
    </>
  )

  return { send: (name) => save(name, null, null), pending, sheets, showing: flow !== null && flowOpen }
}
