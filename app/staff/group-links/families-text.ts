// The settings screen's count of families invited to a year's group (#186).
// WhatsApp groups hold at most 1,024 members, and a family may join with more
// than one phone, so the warning starts well before the limit.

export const FAMILIES_WARNING_FROM = 900

// "312 families invited, not group members": nobody knows who joined.
export function familiesInvitedText(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "family" : "families"} invited, not group members.`
}

export function familiesWarning(count: number): string | null {
  if (count < FAMILIES_WARNING_FROM) return null
  return "This group is close to WhatsApp's 1,024-member limit. Open a second group and save its link here before it fills."
}
