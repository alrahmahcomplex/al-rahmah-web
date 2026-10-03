import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import type { Lead } from "@/lib/services/leads"

import { closedState } from "./closed-state"

// Whether a Reopening request can be sent yet. #99 adds the request form to
// the reopen page and turns this on; until then the banner says so plainly
// rather than offering an action that isn't there.
export const REOPENING_REQUESTS_OPEN = false

// In place of the work actions on a Declined, Inactive or Archived lead: why
// nothing here can be changed, and the way to reopening for staff who may
// raise a reopening request.
export function ClosedLeadBanner({ lead, canRequestReopening }: { lead: Lead; canRequestReopening: boolean }) {
  const title = `This lead is ${closedState(lead)}`

  return (
    <section
      aria-label={title}
      className="flex max-w-xl flex-col gap-3 rounded-lg border bg-card p-4 text-sm"
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="text-muted-foreground">
        A closed lead is read-only. To work on it again, it has to be reopened, and a Manager approves that.
      </p>
      {canRequestReopening &&
        (REOPENING_REQUESTS_OPEN ? (
          <div>
            <Link href={`/staff/leads/${lead.id}/reopen?source=lead`} className={buttonVariants({ size: "sm" })}>
              Request reopening
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground">Reopening requests can&apos;t be sent yet.</p>
            <Link
              href={`/staff/leads/${lead.id}/reopen?source=lead`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              About reopening
            </Link>
          </div>
        ))}
    </section>
  )
}
