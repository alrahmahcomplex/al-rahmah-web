import type { LeadHistoryEntry } from "@/lib/services/audit"

import type { DescribedEntry } from "./describe"

// A lead with a retaken interview (#71) has two interviews in its history.
// Each of their entries then names the interview's S/N, and the later
// registration reads as the retaken interview. A lead with one interview
// reads as before.

// Each interview's S/N by interview id, in the order they were registered.
export type InterviewSerials = ReadonlyMap<string, { serialNumber: unknown; retake: boolean }>

export function interviewSerials(entries: readonly LeadHistoryEntry[]): InterviewSerials {
  const registrations = entries
    .filter((entry) => entry.record === "interviews" && entry.action === "insert" && entry.recordId)
    .sort((a, b) => a.id - b.id)
  return new Map(
    registrations.map((entry, i) => [
      entry.recordId as string,
      { serialNumber: entry.changes.find((c) => c.field === "serial_number")?.to ?? null, retake: i > 0 },
    ]),
  )
}

export function withInterviewSerial(
  entry: LeadHistoryEntry,
  described: DescribedEntry,
  serials: InterviewSerials,
): DescribedEntry {
  if (entry.record !== "interviews" || serials.size < 2 || !entry.recordId) return described
  const interview = serials.get(entry.recordId)
  if (!interview) return described
  const summary =
    entry.action === "insert" && interview.retake ? "registered the lead for a retaken interview" : described.summary
  return { ...described, summary: `${summary} (S/N ${String(interview.serialNumber)})` }
}
