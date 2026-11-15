import Link from "next/link"

import { Tag } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import { SEAT_RELEASE_REASON } from "@/lib/services/lead-closure"
import type { ClassSeats } from "@/lib/services/seats"

import { declineHref } from "../applicants/decline-link"

// One over-full class's leads, ranked: Full, then First instalment, then
// Deposit; then the date each reached its priority, oldest first; then
// Admission Number. Leads ranked past the last seat are marked. For staff who
// may decline, each lead without a closure mark links straight into its
// Decline with No seat available chosen; a marked lead can't be declined.
// The Seat priority is a Line tag: on a lead, a tag that is not its status
// uses `line` (components/kit/README.md, Chips).
export function RankedClass({ entry, canDecline }: { entry: ClassSeats; canDecline: boolean }) {
  const name = `${entry.className} ${entry.dayOrBoarding}`
  const seats = entry.seats ?? 0
  return (
    <section aria-label={`${name} ranking`} className="st-rank">
      <h3>
        {name}: {entry.taken} applicants for {seats} {seats === 1 ? "seat" : "seats"}
      </h3>
      <ol aria-label={`${name} applicants ranked`} className="st-list">
        {(entry.ranked ?? []).map((holder) => (
          <li key={holder.leadId}>
            <span className="st-no">{holder.rank}.</span>
            <span className="st-who">
              <Link href={`/staff/applicants/${holder.leadId}`} className="st-name">
                {holder.studentName}
              </Link>
              <span className="st-cap">
                {holder.admissionNumber} · since {formatDate(holder.reachedOn)}
                {holder.closure && ` · ${holder.closure}`}
              </span>
            </span>
            <span className="st-marks">
              <Tag tone="line">{holder.priority}</Tag>
              {holder.rank > seats && <span className="st-past">Past the last seat</span>}
            </span>
            {canDecline && !holder.closure && (
              <Link
                href={declineHref(holder.leadId, SEAT_RELEASE_REASON)}
                aria-label={`Decline ${holder.studentName}: ${SEAT_RELEASE_REASON}`}
                className="st-decline"
              >
                Decline: {SEAT_RELEASE_REASON}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
