"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import { approveMarketingAgent } from "./actions"

// The Approve button on a Pending agent's row. It asks the Manager to confirm
// the agent's name and code first, since approval can't be undone.
export function ApproveAgent({ agent }: { agent: { id: string; fullName: string; code: string } }) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function approve() {
    setOpen(false)
    setRefusal(null)
    startTransition(async () => {
      const outcome = await approveMarketingAgent(agent.id, { fullName: agent.fullName, code: agent.code })
      if (outcome.status === "approved") toast.success(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending} aria-label={`Approve ${agent.fullName}`}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      {refusal && (
        <p role="alert" className="max-w-56 text-xs text-destructive">
          {refusal}
        </p>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {agent.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their code <span className="font-mono font-semibold text-foreground">{agent.code}</span> will give
              families the interview discount. Approval can&apos;t be undone. Tell the agent yourself, by WhatsApp or a
              call.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={approve}>Approve {agent.code}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
