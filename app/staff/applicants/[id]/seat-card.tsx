import type { SupabaseClient } from "@supabase/supabase-js"

import { Note } from "@/components/kit"
import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"
import { getSeatOutlook, getYearStreams, type SeatOutlook } from "@/lib/services/streams"

import { OpenStreamButton, RequestStreamButton } from "../../seats/stream-sheets"
import { blockedNote, bookedSentence, seatWillBe, waitingNote } from "./seat-text"

// Record payment's seat note (#449, v42): where the payment would place the
// child, or why no stream can take them, with the Manager's Open a new stream
// or other staff's request. Nothing in a class with no streams, or once the
// child is placed.

export type SeatState = { outlook: SeatOutlook; card: React.ReactNode } | null

export async function readSeatCard(supabase: SupabaseClient, lead: Lead, staff: StaffMember): Promise<SeatState> {
  const read = await getSeatOutlook(supabase, lead.id)
  if (!read.ok) return null
  const outlook = read.data
  if (!outlook.hasStreams || outlook.placed) return null
  const child = { studentName: lead.studentName, gender: lead.gender, className: lead.className }

  if (outlook.waiting) {
    const note = waitingNote(child)
    return {
      outlook,
      card: (
        <Note tone="wait">
          <span>
            <b>{note.title}</b> {note.text}
          </span>
        </Note>
      ),
    }
  }

  if (outlook.blocked) {
    const year = await getYearStreams(supabase, lead.enrollmentYear)
    const streams = year.ok ? (year.data.classes.find((c) => c.className === lead.className)?.streams ?? []) : []
    const note = blockedNote(child, streams)
    const need = lead.gender === "Boy" ? "Boys" : lead.gender === "Girl" ? "Girls" : null
    const asked = outlook.request !== null && outlook.request.resolvedAt === null
    return {
      outlook,
      card: (
        <div className="lr-form">
          <Note tone="bad">
            <span>
              <b>{note.title}</b> {note.text}
            </span>
          </Note>
          {staff.permissions.includes("academic_years.manage") ? (
            year.ok && (
              <OpenStreamButton
                year={lead.enrollmentYear}
                className={lead.className}
                streams={streams}
                need={need ?? "Mixed"}
                label={`Open a new ${lead.className} stream`}
                variant="go"
                size="wide"
                forChild={{ leadId: lead.id, studentName: lead.studentName }}
              />
            )
          ) : (
            <RequestStreamButton target={{ leadId: lead.id }} className={lead.className} need={need} size="wide" alreadySent={asked} />
          )}
          <p className="lr-quiet">The interview fee can still be recorded while the streams are full.</p>
        </div>
      ),
    }
  }

  if (outlook.wouldTake) {
    const booked = bookedSentence(outlook)
    return {
      outlook,
      card: (
        <Note>
          <span>
            {seatWillBe(child, outlook.wouldTake)}
            {booked && ` ${booked}`}
          </span>
        </Note>
      ),
    }
  }
  return null
}
