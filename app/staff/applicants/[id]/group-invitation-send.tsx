"use client"

import { useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"

import { sendInvitation } from "./group-invitation-actions"
import type { InvitationOutcome } from "./group-invitation-outcome"

const LOST_REQUEST: InvitationOutcome = {
  status: "refused",
  message: "Sending could not be confirmed. Check your connection, reload the page and see whether it shows as sent.",
}

const COPY_FAILED: InvitationOutcome = {
  status: "refused",
  message: "The invitation could not be copied, so nothing was recorded. Try again.",
}

type Props = { leadId: string; year: number; url: string; message: string }

// Send WhatsApp group invitation. The tab opens inside the click, so no
// pop-up blocker stops it; it is pointed at the wa.me link once the send is
// recorded, and closed if it is refused. If the browser blocked the tab
// anyway, the link shows here to open by hand.
export function SendGroupInvitation({ leadId, year, url }: Omit<Props, "message">) {
  const [outcome, setOutcome] = useState<InvitationOutcome | null>(null)
  const [blockedLink, setBlockedLink] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send() {
    const tab = window.open("", "_blank")
    // WhatsApp gets no handle back on this page.
    if (tab) tab.opener = null
    setOutcome(null)
    setBlockedLink(null)
    startTransition(async () => {
      let result: InvitationOutcome
      try {
        result = await sendInvitation(leadId, "link", year, url)
      } catch {
        result = LOST_REQUEST
      }
      if (result.status === "sent" && result.link) {
        if (tab && !tab.closed) tab.location.href = result.link
        else setBlockedLink(result.link)
      } else {
        tab?.close()
      }
      setOutcome(result)
    })
  }

  return (
    <div className="lr-card">
      <div>
        <Button variant="ghost" size="small" onClick={send} pending={pending}>
          {pending ? "Opening WhatsApp…" : "Send WhatsApp group invitation"}
        </Button>
      </div>
      {outcome?.status === "sent" && (
        <p role="status" className="lr-saved">
          {blockedLink ? (
            <>
              Recorded as sent. The browser blocked the WhatsApp tab:{" "}
              <a href={blockedLink} target="_blank" rel="noopener noreferrer" className="lr-link">
                open WhatsApp
              </a>{" "}
              and press send there.
            </>
          ) : (
            "Recorded as sent. WhatsApp opened in a new tab: press send there."
          )}
        </p>
      )}
      <Refusal outcome={outcome} />
    </div>
  )
}

// Copy the invitation, for a family with no number WhatsApp can take. The
// send is recorded only after the browser confirms the clipboard write.
export function CopyGroupInvitation({ leadId, year, url, message }: Props) {
  const [outcome, setOutcome] = useState<InvitationOutcome | null>(null)
  const [pending, startTransition] = useTransition()

  function copy() {
    setOutcome(null)
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(message)
      } catch {
        setOutcome(COPY_FAILED)
        return
      }
      let result: InvitationOutcome
      try {
        result = await sendInvitation(leadId, "copy", year, url)
      } catch {
        result = LOST_REQUEST
      }
      setOutcome(result)
    })
  }

  return (
    <div className="lr-card">
      <div>
        <Button variant="ghost" size="small" onClick={copy} pending={pending}>
          {pending ? "Copying…" : "Copy invitation"}
        </Button>
      </div>
      {outcome?.status === "sent" && (
        <p role="status" className="lr-saved">
          Copied and recorded as sent. Paste it into a message to the family.
        </p>
      )}
      <Refusal outcome={outcome} />
    </div>
  )
}

function Refusal({ outcome }: { outcome: InvitationOutcome | null }) {
  if (outcome?.status !== "refused") return null
  return (
    <Note tone="bad" role="alert">{outcome.message}</Note>
  )
}
