"use client"

import { useState, useTransition } from "react"

import { Button, Checkbox, KeyValueList, Note, Popover, PopoverClose, Sheet, toast } from "@/components/kit"

import { readAgentSignIn, removeSignIn, type SignInAnswer } from "./sign-in-actions"
import "./agents.css"

type Agent = { id: string; fullName: string; code: string }

// A day and time in East Africa Time, such as 21 Nov 2026, 10:42.
const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Dar_es_Salaam" })

const LOST = "The sign-in could not be read just now. Try again in a moment."

// Remove this sign-in (#503, prototype v58 R1 and R2): the agent's More menu
// holds it as a red item, on a joined agent, for staff with agents.approve.
// The sheet names what the agent signs in with and since when, so the
// office can check it against the real agent on the phone.
export function RemoveSignIn({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false)
  const [signIn, setSignIn] = useState<SignInAnswer | { status: "loading" }>({ status: "loading" })
  const [closeEmail, setCloseEmail] = useState(true)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    setRefusal(null)
    if (!next) return
    setCloseEmail(true)
    // Read afresh each time: the sheet shows the sign-in the removal meets.
    setSignIn({ status: "loading" })
    readAgentSignIn(agent.id)
      .then(setSignIn)
      .catch(() => setSignIn({ status: "refused", message: LOST }))
  }

  function remove() {
    if (signIn.status !== "ready") return
    const login = signIn.login
    setRefusal(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await removeSignIn(agent.id, closeEmail, login)
      } catch {
        outcome = { status: "refused" as const, message: "We lost the answer, so the sign-in may or may not have been removed. Reload the page to check." }
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      toast(outcome.message, { tone: "good" })
    })
  }

  return (
    <>
      <Popover
        size="narrow"
        trigger={
          <Button variant="ghost" size="small" aria-label={`More actions for ${agent.fullName}`}>
            More
          </Button>
        }
        title="More actions"
        closeLabel="Close"
      >
        <div className="flex flex-col gap-2">
          <PopoverClose
            render={
              <Button variant="bad" onClick={() => changeOpen(true)}>
                Remove this sign-in
              </Button>
            }
          />
        </div>
      </Popover>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title="Remove this sign-in?"
        hint={`${agent.fullName} (${agent.code})`}
        closeLabel="Close"
        foot={
          <>
            <Button variant="bad" size="wide" onClick={remove} disabled={pending || signIn.status !== "ready"}>
              {pending ? "Removing…" : "Remove this sign-in"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="ag-stack">
          {signIn.status === "loading" && <p className="ag-p ag-quiet">Reading the sign-in…</p>}
          {signIn.status === "refused" && (
            <Note tone="bad" role="alert">
              {signIn.message}
            </Note>
          )}
          {signIn.status === "ready" && (
            <KeyValueList
              items={[
                { key: "Signs in with", value: signIn.signedInWith },
                { key: "Joined", value: signIn.joinedAt ? WHEN.format(new Date(signIn.joinedAt)) : "Unknown", numeric: true },
              ]}
            />
          )}
          <Note tone="wait">
            This person is signed out everywhere, and the code goes back to &quot;Not joined&quot;. The code, names and students stay.
          </Note>
          <Checkbox
            label="Close email self-confirm on this code until the real agent is set up"
            checked={closeEmail}
            onCheckedChange={setCloseEmail}
            disabled={pending}
          />
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </div>
      </Sheet>
    </>
  )
}
