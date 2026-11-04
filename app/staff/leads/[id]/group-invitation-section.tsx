import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
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
    <section aria-labelledby="group-invitation" className="flex max-w-xl flex-col gap-3">
      <h2 id="group-invitation" className="text-sm font-semibold text-slate-900">
        WhatsApp group invitation
      </h2>
      {!view.ok ? (
        <Alert variant="destructive">
          <AlertDescription>The group invitation could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <>
          {view.data.latest ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-slate-900">{sentLine(view.data.latest)}</p>
              {view.data.latest.earlierLink && <p className="text-sm font-medium text-amber-700">{EARLIER_LINK_TEXT}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No invitation sent yet.</p>
          )}
          {open && view.data.canSend && <Offer leadId={lead.id} view={view.data} />}
        </>
      )}
    </section>
  )
}

function Offer({ leadId, view }: { leadId: string; view: GroupInvitationView }) {
  if (view.blocked === "not_visited") {
    return <p className="text-sm text-muted-foreground">The invitation can be sent once the family has visited.</p>
  }
  if (view.blocked === "no_link") {
    return (
      <div>
        <Link href={`/staff/group-links?year=${view.year}`} className={buttonVariants({ variant: "outline" })}>
          No group link saved for {view.year}: save one
        </Link>
      </div>
    )
  }
  const offer = view.offer
  if (view.blocked !== null || !offer) return null
  if (offer.message === null) {
    return (
      <p className="text-sm text-muted-foreground">
        The {view.year} group link makes the message too long for WhatsApp. Check it under{" "}
        <Link href={`/staff/group-links?year=${view.year}`} className="underline underline-offset-4">
          WhatsApp groups
        </Link>
        .
      </p>
    )
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {offer.channel === "whatsapp"
          ? `To the WhatsApp number ${spacedPhone(offer.phone ?? "")}. The wording is fixed.`
          : offer.channel === "phone"
            ? `To the direct phone ${spacedPhone(offer.phone ?? "")}, as there's no separate WhatsApp number. The wording is fixed.`
            : NO_NUMBER_TEXT}
      </p>
      <div
        role="group"
        aria-label="Invitation preview"
        className="max-h-96 overflow-y-auto rounded-lg bg-muted p-3 text-sm break-words whitespace-pre-wrap text-slate-900"
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
