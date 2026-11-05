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
      if ("inviteSent" in outcome && !outcome.inviteSent && email) toast.warning(outcome.message)
      else toast.success(outcome.message)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending || emailUnknown} aria-label={`Approve ${agent.fullName}`}>
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
              families the interview discount. Approval can&apos;t be undone.
            </AlertDialogDescription>
            <AlertDialogDescription>
              {email ? (
                <>
                  An invite to set a password goes to <span className="font-semibold text-foreground">{email}</span>.
                  Check it is theirs.
                </>
              ) : (
                "They have no email, so no invite goes out. Tell them yourself, by WhatsApp or a call."
              )}
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
