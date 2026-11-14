"use client"

import { useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button, ButtonLink, Popover, PopoverClose } from "@/components/kit"
import type { DeclinedReason, MarkMove } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { DECLINE_PARAM, linkedDeclineReason } from "../decline-link"
import { DeclineLead } from "./decline-lead"
import { MarkLead } from "./mark-lead"
import { MARK_LABEL } from "./mark-text"

type MenuLead = { id: string; studentName: string; admissionNumber: string; status: LeadStatus }

// The lead's rare actions, behind More in the header: Decline, Mark inactive,
// Archive and Request reopening, in a kit popover as the account menu draws
// its own. The page decides which the staff member may use on this lead, by
// the same rules the panels used; each opens the sheet or page it opened
// before. Nothing to offer, no More.
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
      <Popover
        size="narrow"
        trigger={
          <Button variant="ghost" size="small" aria-label="More actions">
            More
          </Button>
        }
        title="More actions"
        closeLabel="Close"
      >
        <div className="flex flex-col gap-2">
          {canRequestReopening && (
            <ButtonLink href={`/staff/applicants/${lead.id}/reopen?source=lead`} variant="ghost">
              Request reopening
            </ButtonLink>
          )}
          {marks.map((mark) => (
            <PopoverClose
              key={mark}
              render={
                <Button variant="ghost" onClick={() => setDialog(mark)}>
                  {MARK_LABEL[mark]}
                </Button>
              }
            />
          ))}
          {declineReasons !== null && (
            <PopoverClose
              render={
                <Button variant="ghost" onClick={() => setDialog("decline")}>
                  Decline
                </Button>
              }
            />
          )}
        </div>
      </Popover>
      {declineReasons !== null && (
        <DeclineLead lead={lead} reasons={declineReasons} open={dialog === "decline"} onOpenChange={close} />
      )}
      {marks.map((mark) => (
        <MarkLead key={mark} lead={lead} mark={mark} open={dialog === mark} onOpenChange={close} />
      ))}
    </>
  )
}
