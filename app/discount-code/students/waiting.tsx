"use client"

import { Check, Copy, MessageCircle, Phone } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { NoticeBox } from "@/components/guided-form"
import { rainConfetti } from "@/components/kit/confetti"
import { FinishMark } from "@/components/kit/states"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { COPY } from "../copy"
import { spendWelcome } from "./actions"

// A new agent's waiting code (#503 slice 4d-b; the lead's decision 1): signed
// in by mobile while the Marketing Office has yet to approve the code, they see
// what a new agent's finish shows today, the code, the link with Copy and
// Share, the note that the discount starts on approval, and when to sign in
// again (O-N62). No students and no discount until the approval. Right after
// the password is set the finish mark and its confetti come first, once.

const OUTLINED =
  "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring) active:scale-[0.97]"

export function WaitingCode({ language, code, link, officePhone, justJoined }: { language: Language; code: string; link: string | null; officePhone: string; justJoined: boolean }) {
  const copy = COPY[language]
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)
  const mark = useRef<HTMLSpanElement>(null)
  // Latched for this visit: spending the greeting refreshes the page with
  // justJoined false, and the mark must stay until its drawing ends (Sol, #538).
  const [showMark] = useState(justJoined)
  useEffect(() => {
    if (!showMark) return
    rainConfetti(mark.current)
    // Once: a refresh or a return shows the page without the mark (Greptile, #538).
    void spendWelcome().catch(() => {})
  }, [showMark])
  // A waiting code takes nothing off yet, so the message names no figure.
  const shareHref = link ? discountCodeShareLink(copy.shareText(code, link, null)) : null

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <section className="flex flex-col items-center gap-4 text-center" data-waiting-code>
      {showMark && <FinishMark ref={mark} />}
      <h2 className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic">{copy.doneTitle}</h2>
      <p
        data-own-code
        className="max-w-full rounded-2xl border-[1.5px] border-dashed border-blue-600/40 px-6 py-2 font-exo text-[2.5rem] leading-tight font-extrabold tracking-wide wrap-anywhere text-blue-600 italic tabular-nums max-[330px]:text-[2rem]"
      >
        {code}
      </p>
      {link && (
        <div className="flex w-full flex-col gap-3 text-left">
          <p className="text-sm font-semibold text-slate-700">{copy.linkLabel}</p>
          <p className="-mt-1.5 rounded-2xl bg-[#f8f7fd] px-4 py-3 font-mono text-sm break-all text-slate-800 ring-1 ring-blue-600/15 select-all">{link}</p>
          <button type="button" onClick={copyLink} className={OUTLINED}>
            {copied === "yes" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
            {copied === "yes" ? copy.copied : copy.copy}
          </button>
          {shareHref && (
            <a href={shareHref} target="_blank" rel="noopener noreferrer" className={OUTLINED}>
              <MessageCircle className="size-5" aria-hidden />
              {copy.share}
            </a>
          )}
          <p aria-live="polite" className={cn("text-sm text-red-600", copied !== "failed" && "sr-only")}>
            {copied === "failed" ? copy.copyFailed : copied === "yes" ? copy.copied : ""}
          </p>
        </div>
      )}
      <NoticeBox tone="wait" className="w-full text-[15px]">
        {copy.confirmNote}
      </NoticeBox>
      <NoticeBox tone="info" className="w-full text-[15px]">
        {copy.mobileWaitNote}
      </NoticeBox>
      <div className="flex flex-col items-center">
        <p className="text-sm text-slate-600">{copy.call}</p>
        <a
          href={`tel:${officePhone.replaceAll(" ", "")}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
        >
          <Phone className="size-5" strokeWidth={2} aria-hidden />
          {officePhone}
        </a>
      </div>
    </section>
  )
}
