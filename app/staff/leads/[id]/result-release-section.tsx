import { Alert, AlertDescription } from "@/components/ui/alert"
import { OFFICE_PHONE } from "@/lib/office"
import { getResultRelease } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

import { blockedText, releaseLine, spacedPhone } from "./result-release-outcome"
import { SendResult } from "./result-release-send"

// The Result release section of the interview panel (slice 6). It says why
// the current result can't go yet, or shows staff who may send it the
// prepared message with Send through WhatsApp and Send SMS instead, or Send
// SMS alone when no number can take a WhatsApp link. Everyone who may view the lead
// sees whether and when it was last sent.
export async function ResultReleaseSection({ leadId }: { leadId: string }) {
  const view = await getResultRelease(await createClient(), leadId, { officePhone: OFFICE_PHONE })

  return (
    <section aria-labelledby="result-release" className="flex max-w-xl flex-col gap-3 border-t pt-3">
      <h3 id="result-release" className="text-sm font-semibold text-slate-900">
        Result release
      </h3>
      {!view.ok ? (
        <Alert variant="destructive">
          <AlertDescription>The result release could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <>
          {view.data.interviewId !== null && (
            <p className="text-sm text-slate-900">
              {view.data.releases[0] ? releaseLine(view.data.releases[0]) : "Not sent yet."}
            </p>
          )}
          {view.data.blocked !== null ? (
            <p className="text-sm text-muted-foreground">{blockedText(view.data.blocked, view.data.amountOwed)}</p>
          ) : !view.data.offer || !view.data.interviewId ? null : view.data.offer.channel === "whatsapp" &&
            view.data.offer.whatsappMessage ? (
            <>
              <p className="text-sm text-muted-foreground">
                By WhatsApp to {spacedPhone(view.data.offer.whatsappPhone ?? "")}. Check the name and score; the wording
                is fixed.
              </p>
              <div
                role="group"
                aria-label="Message preview"
                className="max-h-96 overflow-y-auto rounded-lg bg-muted p-3 text-sm break-words whitespace-pre-wrap text-slate-900"
              >
                {view.data.offer.whatsappMessage}
              </div>
              <SendResult key={view.data.interviewId} leadId={leadId} interviewId={view.data.interviewId} whatsapp />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {view.data.offer.channel === "whatsapp"
                  ? "The names on this lead make the message too long for WhatsApp, so it goes by SMS. Check the student's and the parent's names."
                  : "None of the parent's numbers can take a WhatsApp link, so the result goes by SMS."}{" "}
                Send SMS records the release, then shows the text and the number to send it to from the office phone.
              </p>
              <SendResult
                key={view.data.interviewId}
                leadId={leadId}
                interviewId={view.data.interviewId}
                whatsapp={false}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}
