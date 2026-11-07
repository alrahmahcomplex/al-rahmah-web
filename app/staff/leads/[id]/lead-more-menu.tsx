"use client"

import { EllipsisIcon } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DeclinedReason, MarkMove } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { DECLINE_PARAM, linkedDeclineReason } from "../decline-link"
import { DeclineLead } from "./decline-lead"
import { MarkLead } from "./mark-lead"
import { MARK_LABEL } from "./mark-text"

type MenuLead = { id: string; studentName: string; admissionNumber: string; status: LeadStatus }

// The lead's rare actions, behind More in the header: Decline, Mark inactive,
// Archive and Request reopening. The page decides which the staff member may
// use on this lead, by the same rules the panels used; each opens the dialog
// or page it opened before. Nothing to offer, no More.
export function LeadMoreMenu({
  lead,
  declineReasons,
  marks,
  canRequestReopening,
}: {
  lead: MenuLead
  // Null when Decline isn't offered: a closed lead, or no leads.decline.
  declineReasons: readonly DeclinedReason[] | null
  marks: readonly MarkMove[]
  canRequestReopening: boolean
}) {
  const searchParams = useSearchParams()
  // A link from Seats with a reason opens Decline straight away.
  const linked = declineReasons !== null && linkedDeclineReason(searchParams.get(DECLINE_PARAM), declineReasons) !== null
  const [dialog, setDialog] = useState<"decline" | MarkMove | null>(linked ? "decline" : null)

  if (declineReasons === null && marks.length === 0 && !canRequestReopening) return null

  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }

  return (
    <>
      <DropdownMenu>
        {/* Named apart from the phone tab bar's More. */}
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })} aria-label="More actions">
          <EllipsisIcon aria-hidden="true" />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canRequestReopening && (
            <DropdownMenuItem render={<Link href={`/staff/leads/${lead.id}/reopen?source=lead`} />}>
              Request reopening
            </DropdownMenuItem>
          )}
          {marks.map((mark) => (
            <DropdownMenuItem key={mark} onClick={() => setDialog(mark)}>
              {MARK_LABEL[mark]}
            </DropdownMenuItem>
          ))}
          {declineReasons !== null && (
            <DropdownMenuItem variant="destructive" onClick={() => setDialog("decline")}>
              Decline
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {declineReasons !== null && (
        <DeclineLead lead={lead} reasons={declineReasons} open={dialog === "decline"} onOpenChange={close} />
      )}
      {marks.map((mark) => (
        <MarkLead key={mark} lead={lead} mark={mark} open={dialog === mark} onOpenChange={close} />
      ))}
    </>
  )
}
