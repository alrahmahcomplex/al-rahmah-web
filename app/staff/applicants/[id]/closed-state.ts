import type { Lead } from "@/lib/services/leads"

// What a closed lead is, for its banner: Declined, Inactive, Archived, or
// Declined and marked. Empty for an open lead.
export function closedState(lead: Pick<Lead, "status" | "closure">): string {
  const declined = lead.status === "Declined"
  if (declined && lead.closure) return `Declined and ${lead.closure}`
  return declined ? "Declined" : (lead.closure ?? "")
}
