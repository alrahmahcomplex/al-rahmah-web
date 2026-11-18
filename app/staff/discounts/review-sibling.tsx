"use client"

import { useState } from "react"

import { Button } from "@/components/kit"

import { SiblingReviewSheet, useRefreshed } from "../applicants/[id]/sibling-group"
import type { PendingSiblingView } from "../applicants/[id]/sibling-read"

// Review on a Sibling row of Discount requests (#310): the record's review
// sheet, with the group as a grant would leave it.
export function ReviewSibling({
  leadId,
  studentName,
  father,
  canGrant,
  pending,
}: {
  leadId: string
  studentName: string
  father: string | null
  canGrant: boolean
  pending: PendingSiblingView
}) {
  const [open, setOpen] = useState(false)
  const refreshed = useRefreshed()
  return (
    <>
      <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
        Review
      </Button>
      <SiblingReviewSheet
        open={open}
        onOpenChange={setOpen}
        leadId={leadId}
        studentName={studentName}
        father={father}
        canGrant={canGrant}
        pending={pending}
        onDone={refreshed}
      />
    </>
  )
}
