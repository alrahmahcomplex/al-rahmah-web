import type { SupabaseClient } from "@supabase/supabase-js"

import { GROUP_INVITATION_TEMPLATE_VERSION, renderGroupInvitation } from "@/lib/group-invitation"
import { buildWhatsAppLink } from "@/lib/whatsapp"

import type { Result } from "./result"

// The admissions WhatsApp group invitation (slice 11, #186): what a lead's
// screen shows, and recording a send. The gate and the record are one
// database function, send_group_invitation, so these calls translate what the
// database answers and build the message from the link it checked. The
// year's links themselves are lib/services/group-links.ts.

// Why an invitation can't go from this lead now.
export type InvitationBlocker = "lead_closed" | "not_visited" | "no_link"

// How an invitation went: a wa.me link to the WhatsApp contact or to the
// direct phone, or text staff copied to send themselves.
export type InvitationChannel = "whatsapp" | "phone" | "copy"

export type LatestInvitation = {
  // ISO timestamp.
  sentAt: string
  // The staff member's name, looked up when read.
  sentBy: string
  year: number
  channel: InvitationChannel
  // The lead it was sent from: this one, or a sibling.
  fromLeadId: string
  // The other children it covered, by name.
  withNames: string[]
  // The year's link has been replaced since.
  earlierLink: boolean
}

export type GroupInvitationOffer = {
  channel: InvitationChannel
  // The number the wa.me link opens; null for a copy.
  phone: string | null
  // The year's link, which the message carries.
  url: string
  // Null when the link makes the message too long for WhatsApp.
  message: string | null
}

export type GroupInvitationView = {
  year: number
  blocked: InvitationBlocker | null
  // Whether the caller holds leads.edit.
  canSend: boolean
  // Present only when an invitation can go now and the caller may send it.
  offer: GroupInvitationOffer | null
  latest: LatestInvitation | null
}

type CommonError = "forbidden" | "not-found" | "unavailable"

type StateRow = {
  enrollment_year: number
  blocked: InvitationBlocker | null
  can_send: boolean
  url: string | null
  channel: InvitationChannel | null
  phone: string | null
  latest: {
    sent_at: string
    sent_by: string | null
    enrollment_year: number
    channel: InvitationChannel
    from_lead_id: string
    with_names: string[]
    earlier_link: boolean
  } | null
}

function commonError(error: { message: string; code?: string }): CommonError | null {
  // 42501: the function isn't granted to the caller, as for someone signed out.
  if (error.message === "forbidden" || error.code === "42501") return "forbidden"
  // A malformed id is a missing lead, not an outage.
  if (error.message === "not-found" || error.code === "22P02") return "not-found"
  return null
}

// The group invitation section for a lead. Records nothing. Needs leads.view.
export async function getGroupInvitation(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<GroupInvitationView, CommonError>> {
  const { data, error } = await supabase.rpc("lead_group_invitation", { lead_id: leadId })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    console.error("Could not read a lead's group invitation", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as StateRow
  let offer: GroupInvitationOffer | null = null
  if (row.blocked === null && row.can_send && row.url && row.channel) {
    const message = renderGroupInvitation(row.enrollment_year, row.url)
    offer = { channel: row.channel, phone: row.phone, url: row.url, message: message.ok ? message.data : null }
  }
  const latest = row.latest
  return {
    ok: true,
    data: {
      year: row.enrollment_year,
      blocked: row.blocked,
      canSend: row.can_send,
      offer,
      latest: latest && {
        sentAt: latest.sent_at,
        sentBy: latest.sent_by ?? "A former staff member",
        year: latest.enrollment_year,
        channel: latest.channel,
        fromLeadId: latest.from_lead_id,
        withNames: latest.with_names,
        earlierLink: latest.earlier_link,
      },
    },
  }
}

export type SendInvitationError =
  | CommonError
  | "lead_closed"
  | "not_visited"
  | "no_link"
  // The year's link changed since the caller's page was built.
  | "stale_link"
  | "no_whatsapp_number"
  // The link makes the message too long for WhatsApp.
  | "too_long"

const SEND_REFUSALS: ReadonlySet<string> = new Set<SendInvitationError>([
  "lead_closed",
  "not_visited",
  "no_link",
  "stale_link",
  "no_whatsapp_number",
])

export type SentInvitation = {
  channel: InvitationChannel
  // The wa.me link that opens the chat with the invitation typed in; null for
  // a copy.
  link: string | null
  siblingLeadIds: string[]
}

// Records an invitation from the lead: `link` for a wa.me link to the number
// the database picks, `copy` once staff have copied the text. `year` and
// `linkSeen` are what the caller's message carries; a send for a lead whose
// year or link has changed since is refused and records nothing. Needs
// leads.edit.
export async function sendGroupInvitation(
  supabase: SupabaseClient,
  leadId: string,
  method: "link" | "copy",
  linkSeen: string,
  year: number,
): Promise<Result<SentInvitation, SendInvitationError>> {
  // Rendered before anything is recorded, so a link too long for WhatsApp
  // never leaves a record. The database refuses the send unless its link is
  // this one, so the text is what the record says.
  const message = renderGroupInvitation(year, linkSeen)
  if (!message.ok) return { ok: false, error: "too_long" }

  const { data, error } = await supabase.rpc("send_group_invitation", {
    lead_id: leadId,
    method,
    link_year: year,
    link_seen: linkSeen,
    template_version: GROUP_INVITATION_TEMPLATE_VERSION,
  })
  if (error) {
    const known = commonError(error)
    if (known) return { ok: false, error: known }
    if (SEND_REFUSALS.has(error.message)) return { ok: false, error: error.message as SendInvitationError }
    console.error("Could not record a group invitation", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as { channel: InvitationChannel; phone: string | null; sibling_lead_ids: string[] }
  if (row.channel === "copy") return { ok: true, data: { channel: "copy", link: null, siblingLeadIds: row.sibling_lead_ids } }

  const link = buildWhatsAppLink(message.data, (row.phone ?? "").replace(/^\+/, ""))
  if (!link.ok) {
    console.error("A recorded group invitation's number could not be linked")
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { channel: row.channel, link: link.data, siblingLeadIds: row.sibling_lead_ids } }
}

// How many distinct families were sent an invitation for the year: families
// invited, not group members. Needs leads.view.
export async function countInvitedFamilies(
  supabase: SupabaseClient,
  year: number,
): Promise<Result<number, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("group_invitation_family_count", { link_year: year })
  if (error) {
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not count the families invited to a group", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: Number(data ?? 0) }
}
