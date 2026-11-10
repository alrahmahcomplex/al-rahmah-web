"use client"

import { Check, Copy, MessageCircle } from "lucide-react"
import { useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Labels = { linkLabel: string; copy: string; copied: string; copyFailed: string; share: string }

// The empty list's code, link, Copy and WhatsApp share. `shareHref` is the
// shared WhatsApp module's number-free link, or null when it couldn't be
// built.
export function ShareCode({ code, link, shareHref, labels }: { code: string; link: string; shareHref: string | null; labels: Labels }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-full bg-blue-50 px-4 py-3 text-center font-mono text-[2rem] leading-tight font-bold tracking-wide wrap-anywhere text-blue-600 ring-1 ring-blue-600/15">
        {code}
      </p>
      <div>
        <p className="text-sm font-semibold text-slate-700">{labels.linkLabel}</p>
        <p className="mt-1.5 rounded-2xl bg-[#f8f7fd] px-4 py-3 font-mono text-sm break-all text-slate-800 ring-1 ring-blue-600/15 select-all">
          {link}
        </p>
      </div>
      <button
        type="button"
        onClick={copyLink}
        className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.97]"
      >
        {copied === "yes" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {copied === "yes" ? labels.copied : labels.copy}
      </button>
      {shareHref && (
        <a
          href={shareHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ variant: "orange" }),
            "min-h-13 rounded-full px-6 font-exo text-lg italic shadow-md shadow-orange-500/20",
          )}
        >
          <MessageCircle className="size-5" aria-hidden />
          {labels.share}
        </a>
      )}
      <p aria-live="polite" className={cn("text-sm text-red-600", copied !== "failed" && "sr-only")}>
        {copied === "failed" ? labels.copyFailed : copied === "yes" ? labels.copied : ""}
      </p>
    </div>
  )
}
