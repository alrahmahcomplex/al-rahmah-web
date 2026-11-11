import type { ReactNode } from "react"

import type { LeadClosure, LeadStatus } from "@/lib/services/leads"
import { cn } from "@/lib/utils"

import "./kit.css"

/** `wait`, `ok` and `bad` tags share the lifecycle tints; `line` is a time, a search term or any other tag on a lead. */
export type TagTone = "wait" | "ok" | "bad" | "line"

const STATUS_TONE = {
  Applied: undefined,
  Visited: "visited",
  Interviewed: "interviewed",
  Enrolled: "ok",
  Declined: "bad",
  Inactive: "inactive",
  Archived: "archived",
} as const satisfies Record<LeadStatus | LeadClosure, string | undefined>

/** A lead's status or closure mark (DESIGN.md, Chips). The one place a status is styled. */
export function StatusChip({ status, className }: { status: LeadStatus | LeadClosure; className?: string }) {
  return (
    <span className={cn("kit-chip", className)} data-tone={STATUS_TONE[status]} data-slot="status-chip">
      {status}
    </span>
  )
}

/** A 24px tag: Waiting, Paid, Overdue, a time. The lifecycle tints mean only lifecycle, so other tags on a lead use `line`. */
export function Tag({ tone, className, children }: { tone: TagTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("kit-chip", className)} data-tone={tone}>
      {children}
    </span>
  )
}
