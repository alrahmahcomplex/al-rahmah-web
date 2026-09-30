import { isClosed, type FamilyChild, type FamilyContact, type Relationship } from "@/lib/services/leads"

// The parent as staff typed them, with the numbers as the database
// normalized them, so equal numbers compare equal.
export type TypedParent = {
  fullName: string
  relationship: Relationship
  relationshipDescription: string
  phone: string
  whatsapp: string | null
}

export type ContactRow = { label: string; typed: string; stored: string; differs: boolean }

export function relationshipLabel(relationship: Relationship, description: string | null) {
  return relationship === "Other" ? `Other: ${description ?? ""}` : relationship
}

function tidy(text: string) {
  return text.trim().replace(/\s+/g, " ")
}

// What staff typed beside the confirmed contact, field by field, and whether
// any field differs, which is when staff choose whether to update the contact
// every sibling shares.
export function compareContact(typed: TypedParent, stored: FamilyContact): { differs: boolean; rows: ContactRow[] } {
  const description = typed.relationship === "Other" ? tidy(typed.relationshipDescription) : null
  const pairs: [string, string, string][] = [
    ["Full name", tidy(typed.fullName), stored.fullName],
    [
      "Relationship",
      relationshipLabel(typed.relationship, description),
      relationshipLabel(stored.relationship, stored.relationshipDescription),
    ],
    ["Phone", typed.phone, stored.phone],
    ["WhatsApp", typed.whatsapp ?? "Same as phone", stored.whatsapp ?? "Same as phone"],
  ]
  const rows = pairs.map(([label, mine, theirs]) => ({ label, typed: mine, stored: theirs, differs: mine !== theirs }))
  return { differs: rows.some((row) => row.differs), rows }
}

// Where picking a listed child leads: an active child's own lead, or, for a
// Declined, Inactive or Archived one, the Reopening request hand-off.
export function childHref(child: Pick<FamilyChild, "id" | "status" | "closure">) {
  return isClosed(child) ? `/staff/leads/${child.id}/reopen?source=duplicate_match` : `/staff/leads/${child.id}`
}
