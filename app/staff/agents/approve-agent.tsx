"use client"

import { useState, useTransition } from "react"

import { Button, Sheet } from "@/components/kit"

import { approveMarketingAgent } from "./actions"
import { toast } from "./form-parts"
import "./agents.css"

// The Approve button on a Pending agent's row. It asks the Manager to confirm
// the agent's name, code and email first, since approval can't be undone and
// the invite goes to that email. With `emailUnknown` (the emails couldn't be
// read) it can't be pressed, so no agent is approved without their invite.
export function ApproveAgent({
  agent,
  email,
  emailUnknown = false,
}: {
  agent: { id: string; fullName: string; code: string }
  email: string | null
  emailUnknown?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function approve() {
    setOpen(false)
    setRefusal(null)
    startTransition(async () => {
      const outcome = await approveMarketingAgent(agent.id, { fullName: agent.fullName, code: agent.code }, email)
      if (outcome.status !== "approved") return setRefusal(outcome.message)
      toast(outcome.message)
    })
  }

  return (
    <div className="ag-cell">
      <Button size="small" variant="ghost" onClick={() => setOpen(true)} disabled={pending || emailUnknown} aria-label={`Approve ${agent.fullName}`}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      {refusal && (
        <p role="alert" className="ag-error">
          {refusal}
        </p>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={`Approve ${agent.fullName}?`}
        hint={
          <>
            Their code <span className="ag-mono ag-strong">{agent.code}</span> will give families the interview discount. Approval
            can&apos;t be undone.
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" onClick={approve}>
              Approve {agent.code}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <p className="ag-p">
          {email ? (
            <>
              An invite to set a password goes to <span className="ag-strong">{email}</span>. Check it is theirs.
            </>
          ) : (
            "They have no email, so no invite goes out. Tell them yourself, by WhatsApp or a call."
          )}
        </p>
      </Sheet>
    </div>
  )
}
