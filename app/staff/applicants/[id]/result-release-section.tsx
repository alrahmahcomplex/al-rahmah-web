import { Note } from "@/components/kit"
import { OFFICE_PHONE } from "@/lib/office"
import { getResultRelease } from "@/lib/services/result-release"
import { createClient } from "@/utils/supabase/server"

import { blockedText, changedSinceSentText, releaseLine, repeatSendText, smsNote, spacedPhone } from "./result-release-outcome"
import { SendResult } from "./result-release-send"

// The Result release section of the interview panel (slice 6). It says why
// the current result can't go yet, or shows staff who may send it the
// prepared message with Send through WhatsApp and Send SMS instead, or Send
// SMS alone when no number can take a WhatsApp link or the names make the
// WhatsApp message too long. Everyone who may view the lead sees whether and
// when it was last sent. Once it has been sent, either button asks first,
// saying when, how and by whom it went; when the result or score was
// corrected since, a warning above the buttons says so, without blocking. The
// SMS text and the direct phone stay on the server
// until a release is recorded; only the note about the text's length goes
// ahead of it.
export async function ResultReleaseSection({ leadId }: { leadId: string }) {
  const view = await getResultRelease(await createClient(), leadId, { officePhone: OFFICE_PHONE })
  const last = view.ok ? (view.data.latestRelease ?? undefined) : undefined
  const changed = view.ok && view.data.changedSinceSent
  const repeat = last ? repeatSendText(last, changed) : null

  return (
    <section aria-labelledby="result-release" className="lr-part">
      <h3 id="result-release" className="lr-sub">
        Result release
      </h3>
      {!view.ok ? (
        <Note tone="bad">The result release could not be loaded. Try again in a moment.</Note>
      ) : (
        <>
          {view.data.interviewId !== null && (
            <p className="lr-text">
              {view.data.latestRelease ? releaseLine(view.data.latestRelease) : "Not sent yet."}
            </p>
          )}
          {changed && last && (
            <div role="note" aria-label="Changed since sent">
              <Note tone="wait">{changedSinceSentText(last)}</Note>
            </div>
          )}
          {view.data.blocked !== null ? (
            <p className="lr-quiet">{blockedText(view.data.blocked, view.data.amountOwed)}</p>
          ) : !view.data.offer || !view.data.interviewId ? null : view.data.offer.channel === "whatsapp" &&
            view.data.offer.whatsappMessage ? (
            <SendResult
              key={view.data.interviewId}
              leadId={leadId}
              interviewId={view.data.interviewId}
              smsNote={smsNote(view.data.offer.smsMessage)}
              seenReleases={view.data.releaseCount}
              repeat={repeat}
              whatsappPreview={
                <>
                  <p className="lr-quiet">
                    By WhatsApp to {spacedPhone(view.data.offer.whatsappPhone ?? "")}. Check the name and score; the
                    wording is fixed.
                  </p>
                  <div
                    role="group"
                    aria-label="Message preview"
                    className="lr-quote max-h-96 overflow-y-auto"
                  >
                    {view.data.offer.whatsappMessage}
                  </div>
                </>
              }
            />
          ) : (
            <>
              <p className="lr-quiet">
                {view.data.offer.channel === "whatsapp"
                  ? "The names on this application make the message too long for WhatsApp, so it goes by SMS. Check the student's and the parent's names."
                  : "None of the parent's numbers can take a WhatsApp link, so the result goes by SMS."}{" "}
                Send SMS records the release, then shows the text and the number to send it to from the office phone.
              </p>
              <SendResult
                key={view.data.interviewId}
                leadId={leadId}
                interviewId={view.data.interviewId}
                smsNote={smsNote(view.data.offer.smsMessage)}
                seenReleases={view.data.releaseCount}
                repeat={repeat}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}
