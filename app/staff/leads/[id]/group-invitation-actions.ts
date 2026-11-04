"use server"

import { revalidatePath } from "next/cache"

import { sendGroupInvitation } from "@/lib/services/group-invitations"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { invitationRefusal, type InvitationOutcome } from "./group-invitation-outcome"

// Records a group invitation from the lead: `link` hands back the wa.me link
// for the tab the click opened; `copy` is called only after the browser
// confirmed the clipboard write. `year` and `linkSeen` are what the message
// on the page carries. A POST, so the message and link never appear in our
// own URLs. The database checks the permission and the whole gate again.
export async function sendInvitation(
  leadId: string,
  method: "link" | "copy",
  year: number,
  linkSeen: string,
): Promise<InvitationOutcome> {
  const how = method === "copy" ? "copy" : "link"
  if (
    typeof leadId !== "string" ||
    (method !== "link" && method !== "copy") ||
    !Number.isInteger(year) ||
    typeof linkSeen !== "string"
  ) {
    return invitationRefusal("not-found", how)
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return invitationRefusal("forbidden", how)

  const sent = await sendGroupInvitation(supabase, leadId, method, linkSeen, year)
  if (!sent.ok) return invitationRefusal(sent.error, how)
  revalidatePath(`/staff/leads/${leadId}`)
  for (const sibling of sent.data.siblingLeadIds) revalidatePath(`/staff/leads/${sibling}`)
  return { status: "sent", link: sent.data.link }
}
