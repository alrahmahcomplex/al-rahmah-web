"use client"

import { Check, Copy, MessageCircle, MessageSquareText } from "lucide-react"
import { useState, useTransition, type ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import { sendResultBySms, sendResultByWhatsApp } from "./result-release-actions"
import { spacedPhone, type ReleaseRefusal } from "./result-release-outcome"

const LOST_REQUEST: ReleaseRefusal = {
  status: "refused",
  message: "Sending could not be confirmed. Check your connection, reload the page and see whether it shows as sent.",
}

type Outcome =
  | { status: "whatsapp"; blockedLink: string | null }
  | { status: "sms"; text: string; phone: string; note: string | null }
  | ReleaseRefusal

// The Result release section's send buttons: Send through WhatsApp with Send
// SMS instead beside it, or Send SMS alone when no number can take a WhatsApp
// link. Each click records a release.
//
// Send through WhatsApp opens its tab inside the click, so no pop-up blocker
// stops it; the tab is pointed at the wa.me link once the release is
// recorded, and closed if the release is refused. If the browser blocked the
// tab anyway, the link shows here to open by hand.
//
// Send SMS records the release and only then shows the short text and the
// number, each with a Copy button, for staff to send from the office phone.
// The WhatsApp preview then gives way, so staff copy only the SMS's number.
// The note about a long SMS text shows before and after the send.
//
// Once the result has been sent, either button first asks staff to confirm,
// saying when, how and by whom it last went. Only Send again records a
// release, and for WhatsApp opens the tab inside that click; cancelling does
// neither. Each send says how many releases the page showed, and is refused
// if someone sent the result since; the WhatsApp tab then closes.
export function SendResult({
  leadId,
  interviewId,
  smsNote,
  seenReleases,
  repeat,
  whatsappPreview,
}: {
  leadId: string
  interviewId: string
  smsNote: string | null
  // How many releases of this interview the page shows.
  seenReleases: number
  // What the confirmation says about the last release, once there is one.
  repeat: string | null
  // The WhatsApp message and number, when WhatsApp is offered.
  whatsappPreview?: ReactNode
}) {
  const whatsapp = whatsappPreview !== undefined
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [sending, setSending] = useState<"whatsapp" | "sms" | null>(null)
  const [pending, startTransition] = useTransition()
  // The channel the confirmation is for. It outlives the dialog's closing,
  // so the button's label doesn't change while the dialog fades out.
  const [confirming, setConfirming] = useState<"whatsapp" | "sms">("whatsapp")
  const [asking, setAsking] = useState(false)

  function ask(channel: "whatsapp" | "sms") {
    if (repeat === null) {
      if (channel === "whatsapp") sendWhatsApp()
      else sendSms()
      return
    }
    setConfirming(channel)
    setAsking(true)
  }

  function sendAgain() {
    // A second click while the dialog fades out sends nothing more.
    if (!asking) return
    setAsking(false)
    if (confirming === "whatsapp") sendWhatsApp()
    else sendSms()
  }

  function sendWhatsApp() {
    const tab = window.open("", "_blank")
    // WhatsApp gets no handle back on this page.
    if (tab) tab.opener = null
    setOutcome(null)
    setSending("whatsapp")
    startTransition(async () => {
      let result
      try {
        result = await sendResultByWhatsApp(leadId, interviewId, seenReleases)
      } catch {
        result = LOST_REQUEST
      }
      if (result.status === "released") {
        const opened = tab !== null && !tab.closed
        if (opened) tab.location.href = result.link
        setOutcome({ status: "whatsapp", blockedLink: opened ? null : result.link })
      } else {
        tab?.close()
        setOutcome(result)
      }
    })
  }

  function sendSms() {
    setOutcome(null)
    setSending("sms")
    startTransition(async () => {
      let result
      try {
        result = await sendResultBySms(leadId, interviewId, seenReleases)
      } catch {
        result = LOST_REQUEST
      }
      setOutcome(result.status === "released" ? { ...result, status: "sms" } : result)
    })
  }

  const sentBySms = outcome?.status === "sms"

  return (
    <div className="flex flex-col gap-3">
      {whatsapp &&
        (sentBySms ? <p className="text-sm text-muted-foreground">Sent by SMS instead of WhatsApp.</p> : whatsappPreview)}
      <div className="flex flex-wrap gap-2">
        {whatsapp && (
          <Button type="button" onClick={() => ask("whatsapp")} disabled={pending}>
            <MessageCircle aria-hidden="true" />
            {pending && sending === "whatsapp" ? "Opening WhatsApp…" : "Send through WhatsApp"}
          </Button>
        )}
        <Button type="button" variant={whatsapp ? "outline" : "default"} onClick={() => ask("sms")} disabled={pending}>
          <MessageSquareText aria-hidden="true" />
          {pending && sending === "sms" ? "Recording…" : whatsapp ? "Send SMS instead" : "Send SMS"}
        </Button>
      </div>
      {outcome?.status === "whatsapp" && (
        <p role="status" className="text-sm text-emerald-700">
          {outcome.blockedLink ? (
            <>
              Recorded as sent. The browser blocked the WhatsApp tab:{" "}
              <a href={outcome.blockedLink} target="_blank" rel="noopener noreferrer" className="underline">
                open WhatsApp
              </a>{" "}
              and press send there.
            </>
          ) : (
            "Recorded as sent. WhatsApp opened in a new tab: press send there."
          )}
        </p>
      )}
      {smsNote && !sentBySms && <p className="text-sm text-amber-700">{smsNote}</p>}
      {outcome?.status === "sms" && <SmsToSend text={outcome.text} phone={outcome.phone} note={outcome.note} />}
      {outcome?.status === "refused" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      )}

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send the result again?</AlertDialogTitle>
            <AlertDialogDescription>{repeat}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Don&apos;t send</AlertDialogCancel>
            <AlertDialogAction onClick={sendAgain} disabled={pending}>
              {confirming === "sms" ? "Send again by SMS" : "Send again through WhatsApp"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SmsToSend({ text, phone, note }: { text: string; phone: string; note: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm text-emerald-700">
        Recorded as sent. Send this text from the office phone.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-900">
          To <span className="font-medium">{spacedPhone(phone)}</span>
        </p>
        <CopyButton label="Copy number" value={phone} />
      </div>
      <div
        role="group"
        aria-label="SMS text"
        className="rounded-lg bg-muted p-3 text-sm break-words whitespace-pre-wrap text-slate-900"
      >
        {text}
      </div>
      {note && <p className="text-sm text-amber-700">{note}</p>}
      <div>
        <CopyButton label="Copy text" value={text} />
      </div>
    </div>
  )
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={copy}>
        {copied === "yes" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {label}
      </Button>
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {copied === "yes" ? "Copied" : copied === "failed" ? "Could not copy. Select it and copy by hand." : ""}
      </span>
    </span>
  )
}
