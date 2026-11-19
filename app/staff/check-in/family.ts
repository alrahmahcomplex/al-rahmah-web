import { isClosed, type FamilyChild, type Relationship } from "@/lib/services/leads"

export function relationshipLabel(relationship: Relationship, description: string | null) {
  return relationship === "Other" ? `Other: ${description ?? ""}` : relationship
}

// Where picking a listed child leads: an active child's own lead, or, for a
// Declined, Inactive or Archived one, the Reopening request hand-off.
export function childHref(child: Pick<FamilyChild, "id" | "status" | "closure">) {
  return isClosed(child) ? `/staff/applicants/${child.id}/reopen?source=duplicate_match` : `/staff/applicants/${child.id}`
}
