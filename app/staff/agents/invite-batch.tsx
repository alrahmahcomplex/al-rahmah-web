"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"

import { sendMarketingAgentInviteBatch } from "./invite-batch-actions"
import type { BatchActionOutcome } from "./invite-batch-outcome"
import { agentsHref } from "./search-params"
import "./agents.css"
import { toast } from "./form-parts"

// Send invites on "Approved, no account yet" (#192). The dialog says what a
// batch does and what today's budget allows; after it, the page shows the
// batch's report, read from the database.
export function SendInvites({
  importBatchId,
  batchLimit,
  budget,
  disabledReason,
}: {
  // The import the screen shows, so the batch sends only to its agents.
  importBatchId: string | null
  batchLimit: number
  // The line on today's budget.
  budget: string
  // Why no batch can be sent now, or null.
  disabledReason: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    setRefusal(null)
  }

  function reportHref(batchId: string) {
    return agentsHref({ status: "Approved", account: "no_account", importBatchId: importBatchId ?? undefined, batchId, page: 1 })
  }

  function send() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: BatchActionOutcome
      try {
        outcome = await sendMarketingAgentInviteBatch(importBatchId)
      } catch {
        // Cut off, perhaps at the time limit: the latest batch's report
        // shows what was recorded.
        setRefusal("The batch didn't answer before it stopped. Reload the page to see how far it got.")
        router.refresh()
        return
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      if (outcome.status === "stopped") toast(outcome.message)
      setOpen(false)
      router.push(reportHref(outcome.batchId))
    })
  }

  return (
    <>
      <Button variant="ghost" onClick={() => changeOpen(true)} disabled={disabledReason !== null}>
        Send invites
      </Button>
      {disabledReason && <p className="ag-hint">{disabledReason}</p>}
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Send invites${importBatchId ? " to this import's agents" : ""}`}
        hint={`Sends invites one at a time to the agents waiting for one, oldest approval first. Anyone invited in the last 24 hours and anyone with no email is skipped. One batch sends at most ${batchLimit}, and stops at the hourly email limit or today's budget.`}
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" onClick={send} disabled={pending}>
              {pending ? "Sending…" : "Send invites"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </>
        }
      >
        <p className="ag-p">{budget}</p>
        {refusal && (
          <Note tone="bad" role="alert">
            {refusal}
          </Note>
        )}
      </Sheet>
    </>
  )
}
