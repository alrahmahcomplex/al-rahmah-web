import type { LeadHistoryEntry } from "@/lib/services/audit"

// A group invitation's history entry (#186), for describe.ts. Each send is a
// row of whatsapp_group_invitations, shown in the history of the lead it was
// sent from.

const RECORD = "whatsapp_group_invitations"

// The entry already says who sent it and when; sibling ids are for the
// database, and the lead screen names them.
export const GROUP_INVITATION_HIDDEN: ReadonlySet<string> = new Set(["lead_id", "sent_by", "sent_at", "sibling_lead_ids"])

const LABELS: Readonly<Record<string, string>> = {
  url: "Group link",
  template_version: "Message",
  channel: "Sent by",
}

const CHANNELS: Readonly<Record<string, string>> = {
  whatsapp: "WhatsApp, to the parent's WhatsApp number",
  phone: "WhatsApp, to the parent's direct phone",
  copy: "Copied for staff to send",
}

const TEMPLATES: Readonly<Record<string, string>> = {
  group_invitation_v2: "Group invitation (version 2)",
}

export function groupInvitationSummary(entry: Pick<LeadHistoryEntry, "record" | "action" | "changes">): string | null {
  if (entry.record !== RECORD) return null
  if (entry.action !== "insert") return entry.action
  const channel = entry.changes.find((change) => change.field === "channel")?.to
  return channel === "copy" ? "copied the WhatsApp group invitation" : "sent the WhatsApp group invitation"
}

export function groupInvitationLabel(record: string | null, field: string): string | null {
  return record === RECORD ? (LABELS[field] ?? null) : null
}

export function groupInvitationValue(record: string | null, field: string, value: unknown): string | null {
  if (record !== RECORD) return null
  if (field === "channel") return CHANNELS[String(value)] ?? null
  if (field === "template_version") return TEMPLATES[String(value)] ?? null
  return null
}
