"use client"

import { useId, useState } from "react"

import { Button, ButtonLink, ChipButtons, CodeBlock, MessageBox, Note } from "@/components/kit"
import { referralLink } from "@/lib/agent-registration"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import type { PromoCode } from "@/lib/services/promo-codes"

import { tzs } from "../agents/discount-outcome"
import { SHARE_KINDS, SHARE_LANGUAGES, shareMessage, whatsAppHref, withLink, type ShareKind, type ShareLanguage } from "./share-messages"

export const SHARE_HINT = "Send parents the link. The code fills itself in."
const COPY_FAILED = "Couldn’t copy. The text is selected: press Ctrl+C."

// The share view of a code's sheet: whether it is open, the message chosen,
// and staff's edits to each message (by kind and language). Edits last until
// the sheet closes; the sheet starts afresh each time it opens.
export function useShare(promo: PromoCode | null, origin: string | null) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ShareKind>("parent")
  const [language, setLanguage] = useState<ShareLanguage>("en")
  const [edits, setEdits] = useState<Partial<Record<string, string>>>({})
  // Only an Active code gives its amount, so only an Active code is shared.
  const link = promo && origin && promo.effectiveState === "active" ? referralLink(origin, promo.code) : null
  const key = `${kind}|${language}`
  const suggested = promo && link ? shareMessage({ kind, language, code: promo.code, link, amount: promo.amount, endsOn: promo.endsOn }) : ""
  const message = edits[key] ?? suggested
  return {
    link,
    // The share view shows only while the code can still be shared.
    open: open && link !== null,
    setOpen,
    kind,
    setKind,
    language,
    setLanguage,
    message,
    edited: message !== suggested,
    setMessage: (value: string) => setEdits((current) => ({ ...current, [key]: value })),
    reset: () => setEdits((current) => ({ ...current, [key]: undefined })),
  }
}

export type ShareState = ReturnType<typeof useShare>

export function ShareBody({ share, promo }: { share: ShareState; promo: PromoCode }) {
  const ids = useId()
  const link = share.link!
  const linkMissing = !share.message.includes(link)
  return (
    <div className="ag-stack ag-share">
      <CodeBlock label="Link for parents" copyValue={link} copyLabel="Copy link" copiedMessage="Link copied" copyFailedMessage={COPY_FAILED}>
        {link}
      </CodeBlock>
      <div className="ag-stack">
        <p className="ag-label">Message</p>
        <ChipButtons label="Message" options={SHARE_KINDS} value={share.kind} onChange={(value) => share.setKind(value as ShareKind)} />
        <ChipButtons label="Language" options={SHARE_LANGUAGES} value={share.language} onChange={(value) => share.setLanguage(value as ShareLanguage)} />
      </div>
      <div className="ag-stack">
        <MessageBox
          id={`${ids}-message`}
          aria-label="Message to send"
          aria-describedby={`${ids}-message-help`}
          lang={share.language}
          value={share.message}
          onChange={share.setMessage}
          copyLabel="Copy message"
          copiedMessage="Message copied"
          copyFailedMessage={COPY_FAILED}
        />
        <div id={`${ids}-message-help`} className="ag-stack">
          {linkMissing && (
            <Note tone="wait" role="status">
              The link is missing. Without it, parents don’t get the discount.
            </Note>
          )}
          {linkMissing || share.edited ? (
            <div className="ag-row">
              {linkMissing && (
                <Button variant="ghost" size="small" onClick={() => share.setMessage(withLink(share.message, link))}>
                  Put the link back
                </Button>
              )}
              {share.edited && (
                <Button variant="ghost" size="small" icon="reset" onClick={share.reset}>
                  Reset message
                </Button>
              )}
            </div>
          ) : (
            <p className="ag-hint">You can change the message before you send it.</p>
          )}
        </div>
      </div>
      <Note>
        Parents who open the link get the Admission form with {promo.code} filled in and the fee at {tzs(STANDARD_INTERVIEW_FEE - promo.amount)}. The code is remembered for 30
        days.
      </Note>
    </div>
  )
}

// Switching views keeps the sheet open, so focus goes to its title, as when it opened.
function focusSheetTitle(from: HTMLElement) {
  from.closest<HTMLElement>("[role=dialog]")?.querySelector<HTMLElement>(".kit-sheet-title")?.focus()
}

export function ShareButton({ share }: { share: ShareState }) {
  return (
    <Button
      size="wide"
      icon="link"
      onClick={(event) => {
        focusSheetTitle(event.currentTarget)
        share.setOpen(true)
      }}
    >
      Share promo code
    </Button>
  )
}

export function ShareFoot({ share }: { share: ShareState }) {
  return (
    <>
      <ButtonLink href={whatsAppHref(share.message)} target="_blank" rel="noopener noreferrer" size="wide" icon="chat">
        Share on WhatsApp
      </ButtonLink>
      <Button
        variant="ghost"
        size="wide"
        onClick={(event) => {
          focusSheetTitle(event.currentTarget)
          share.setOpen(false)
        }}
      >
        Back
      </Button>
    </>
  )
}
