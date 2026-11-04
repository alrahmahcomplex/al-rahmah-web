import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { LatestInvitation, SendInvitationError } from "@/lib/services/group-invitations"

// The group invitation section's words (#186). Codes never reach the screen.

// "Invitation to the 2027 group sent on 3 Nov 2026 by Amina (with Juma).",
// for the latest invitation that covered the lead. Never "received": the app
// can't know whether the family got it or joined.
export function sentLine(latest: Pick<LatestInvitation, "year" | "sentAt" | "sentBy" | "withNames">): string {
  const on = formatDate(tanzaniaToday(new Date(latest.sentAt)))
  const covered = latest.withNames.length ? ` (with ${latest.withNames.join(", ")})` : ""
  return `Invitation to the ${latest.year} group sent on ${on} by ${latest.sentBy}${covered}.`
}

export const EARLIER_LINK_TEXT = "Sent with an earlier link. Send it again to give the family the current one."

export const NO_NUMBER_TEXT = "No WhatsApp number on file. Copy the invitation to send it yourself."

// What the send and copy buttons are told. The link goes only to the tab the
// click opened; it is never put in the page's own address.
export type InvitationOutcome =
  | { status: "sent"; link: string | null }
  | { status: "refused"; message: string }

export function invitationRefusal(error: SendInvitationError, method: "link" | "copy"): InvitationOutcome {
  // After a copy, the text is already on the clipboard.
  const copied = method === "copy" ? " Don't send what you copied." : ""
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't send the group invitation." }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "lead_closed":
      return { status: "refused", message: `This lead is closed, so nothing was recorded.${copied}` }
    case "not_visited":
      return {
        status: "refused",
        message: `The family hasn't visited yet, so nothing was recorded.${copied} Reload the page.`,
      }
    case "no_link":
      return {
        status: "refused",
        message: `No group link is saved for this year any more, so nothing was recorded.${copied} Reload the page.`,
      }
    case "stale_link":
      return {
        status: "refused",
        message: `The group link or the lead's Enrollment year has changed, so nothing was recorded.${copied} Reload the page to see the current invitation.`,
      }
    case "no_whatsapp_number":
      return {
        status: "refused",
        message: "None of the parent's numbers can take a WhatsApp link, so nothing was sent. Reload the page.",
      }
    case "too_long":
      return {
        status: "refused",
        message: "The group link makes the message too long for WhatsApp, so nothing was sent. Check the link under WhatsApp groups.",
      }
    case "unavailable":
      return { status: "refused", message: `The invitation could not be recorded.${copied} Try again in a moment.` }
  }
}
