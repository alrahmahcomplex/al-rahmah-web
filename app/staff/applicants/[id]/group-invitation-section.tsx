import Link from "next/link"

import { ButtonLink, Note } from "@/components/kit"
import { getGroupInvitation, type GroupInvitationView } from "@/lib/services/group-invitations"
import { createClient } from "@/utils/supabase/server"

import { EARLIER_LINK_TEXT, NO_NUMBER_TEXT, sentLine } from "./group-invitation-outcome"
import { CopyGroupInvitation, SendGroupInvitation } from "./group-invitation-send"
import type { LeadPanelProps } from "./panels"
import { spacedPhone } from "./result-release-outcome"

// The admissions WhatsApp group invitation (slice 11, #186). Everyone who may
// view the lead sees the latest invitation that covered it, sent from it or
// from a sibling. From Visited onward, on an open lead, staff who may edit
// leads get the prepared message and Send WhatsApp group invitation, or Copy
// invitation when no number can take a WhatsApp link. It stays available to
// send again.
export async function GroupInvitationSection({ lead, open }: LeadPanelProps) {
  const view = await getGroupInvitation(await createClient(), lead.id)

  return (
    <section aria-labelledby="group-invitation" className="lr-card">
      <h2 id="group-invitation" className="kit-card-title">
        WhatsApp group invitation
      </h2>
      {!view.ok ? (
        <Note tone="bad">The group invitation could not be loaded. Try again in a moment.</Note>
      ) : (
        <>
          {view.data.latest ? (
            <div className="flex flex-col gap-1">
              <p className="lr-text">{sentLine(view.data.latest)}</p>
              {view.data.latest.earlierLink && <p className="lr-warn font-medium">{EARLIER_LINK_TEXT}</p>}
            </div>
          ) : (
            <p className="lr-quiet">No invitation sent yet.</p>
          )}
          {open && view.data.canSend && <Offer leadId={lead.id} view={view.data} />}
        </>
      )}
    </section>
  )
}

function Offer({ leadId, view }: { leadId: string; view: GroupInvitationView }) {
  if (view.blocked === "not_visited") {
    return <p className="lr-quiet">The invitation can be sent once the family has visited.</p>
  }
  if (view.blocked === "no_link") {
    return (
      <div>
        <ButtonLink href={`/staff/group-links?year=${view.year}`} variant="ghost" size="small">
          No group link saved for {view.year}: save one
        </ButtonLink>
      </div>
    )
  }
  const offer = view.offer
  if (view.blocked !== null || !offer) return null
  if (offer.message === null) {
    return (
      <p className="lr-quiet">
        The {view.year} group link makes the message too long for WhatsApp. Check it under{" "}
        <Link href={`/staff/group-links?year=${view.year}`} className="lr-link">
          WhatsApp groups
        </Link>
        .
      </p>
    )
  }

  return (
    <>
      <p className="lr-quiet">
        {offer.channel === "whatsapp"
          ? `To the WhatsApp number ${spacedPhone(offer.phone ?? "")}. The wording is fixed.`
          : offer.channel === "phone"
            ? `To the direct phone ${spacedPhone(offer.phone ?? "")}, as there's no separate WhatsApp number. The wording is fixed.`
            : NO_NUMBER_TEXT}
      </p>
      <div
        role="group"
        aria-label="Invitation preview"
        className="lr-quote max-h-96 overflow-y-auto"
      >
        {offer.message}
      </div>
      {offer.channel === "copy" ? (
        <CopyGroupInvitation key={offer.url} leadId={leadId} year={view.year} url={offer.url} message={offer.message} />
      ) : (
        <SendGroupInvitation key={offer.url} leadId={leadId} year={view.year} url={offer.url} />
      )}
    </>
  )
}
