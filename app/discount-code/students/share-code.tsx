"use client"

import { Check, Copy } from "lucide-react"
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
      <p className="rounded-3xl bg-blue-50 px-4 py-4 text-center font-mono text-[2rem] font-bold leading-tight tracking-wide text-blue-600 ring-1 ring-blue-100">
        {code}
      </p>
      <div>
        <p className="text-sm font-semibold text-slate-700">{labels.linkLabel}</p>
        <p className="mt-1.5 break-all rounded-2xl bg-slate-50 px-4 py-3 font-mono text-sm text-slate-800 ring-1 ring-slate-200 select-all">
          {link}
        </p>
      </div>
      <button
        type="button"
        onClick={copyLink}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-blue-600/30 px-6 font-exo text-base font-bold italic text-blue-600 outline-none transition hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
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
            "h-12 rounded-full px-6 font-exo text-lg italic shadow-md shadow-orange-500/20",
          )}
        >
          {labels.share}
        </a>
      )}
      <p aria-live="polite" className={cn("text-sm text-red-600", copied !== "failed" && "sr-only")}>
        {copied === "failed" ? labels.copyFailed : copied === "yes" ? labels.copied : ""}
      </p>
    </div>
  )
}
