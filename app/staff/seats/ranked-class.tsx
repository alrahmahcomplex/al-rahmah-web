import Link from "next/link"

import { formatDate } from "@/lib/school-calendar"
import { SEAT_RELEASE_REASON } from "@/lib/services/lead-closure"
import type { ClassSeats } from "@/lib/services/seats"

import { declineHref } from "../leads/decline-link"
import { SeatPriorityBadge } from "../leads/seat-priority-badge"

// One over-full class's leads, ranked: Full, then First instalment, then
// Deposit; then the date each reached its priority, oldest first; then
// Admission Number. Leads ranked past the last seat are marked. For staff who
// may decline, each lead without a closure mark links straight into its
// Decline with No seat available chosen; a marked lead can't be declined.
export function RankedClass({ entry, canDecline }: { entry: ClassSeats; canDecline: boolean }) {
  const name = `${entry.className} ${entry.dayOrBoarding}`
  const seats = entry.seats ?? 0
  return (
    <section aria-label={`${name} ranking`} className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10">
      <h3 className="text-sm font-semibold text-slate-900">
        {name}: {entry.taken} leads for {seats} {seats === 1 ? "seat" : "seats"}
      </h3>
      <ol aria-label={`${name} leads ranked`} className="flex flex-col divide-y text-sm">
        {(entry.ranked ?? []).map((holder) => (
          <li key={holder.leadId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{holder.rank}.</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <Link href={`/staff/leads/${holder.leadId}`} className="font-medium text-slate-900 underline-offset-4 hover:underline">
                {holder.studentName}
              </Link>
              <span className="text-xs text-muted-foreground">
                {holder.admissionNumber} · since {formatDate(holder.reachedOn)}
                {holder.closure && ` · ${holder.closure}`}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <SeatPriorityBadge priority={holder.priority} />
              {holder.rank > seats && <span className="text-xs font-medium text-destructive">Past the last seat</span>}
            </span>
            {canDecline && !holder.closure && (
              <Link
                href={declineHref(holder.leadId, SEAT_RELEASE_REASON)}
                className="w-full text-xs font-medium text-destructive underline-offset-4 hover:underline sm:w-auto"
              >
                Decline<span className="sr-only"> {holder.studentName}</span>: {SEAT_RELEASE_REASON}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
