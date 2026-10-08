"use client"

import { MessageCircle } from "lucide-react"
import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import { sendResultByWhatsApp } from "./result-release-actions"
import type { ReleaseOutcome } from "./result-release-outcome"

const LOST_REQUEST: ReleaseOutcome = {
  status: "refused",
  message: "Sending could not be confirmed. Check your connection, reload the page and see whether it shows as sent.",
}

// Send through WhatsApp. The tab opens inside the click, so no pop-up blocker
// stops it; it is pointed at the wa.me link once the release is recorded, and
// closed if the release is refused. If the browser blocked the tab anyway,
// the link shows here to open by hand.
export function SendResultByWhatsApp({ leadId, interviewId }: { leadId: string; interviewId: string }) {
  const [outcome, setOutcome] = useState<ReleaseOutcome | null>(null)
  const [blockedLink, setBlockedLink] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send() {
    const tab = window.open("", "_blank")
    // WhatsApp gets no handle back on this page.
    if (tab) tab.opener = null
    setOutcome(null)
    setBlockedLink(null)
    startTransition(async () => {
      let result: ReleaseOutcome
      try {
        result = await sendResultByWhatsApp(leadId, interviewId)
      } catch {
        result = LOST_REQUEST
      }
      if (result.status === "released") {
        if (tab && !tab.closed) tab.location.href = result.link
        else setBlockedLink(result.link)
      } else {
        tab?.close()
      }
      setOutcome(result)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" onClick={send} disabled={pending}>
          <MessageCircle aria-hidden="true" />
          {pending ? "Opening WhatsApp…" : "Send through WhatsApp"}
        </Button>
      </div>
      {outcome?.status === "released" && (
        <p role="status" className="text-sm text-emerald-700">
          {blockedLink ? (
            <>
              Recorded as sent. The browser blocked the WhatsApp tab:{" "}
              <a href={blockedLink} target="_blank" rel="noopener noreferrer" className="underline">
                open WhatsApp
              </a>{" "}
              and press send there.
            </>
          ) : (
            "Recorded as sent. WhatsApp opened in a new tab: press send there."
          )}
        </p>
      )}
      {outcome?.status === "refused" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
