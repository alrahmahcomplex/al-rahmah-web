"use client"

import Image from "next/image"
import { useRef, type RefObject } from "react"

import { DocumentLanguage } from "@/components/document-language"
import { useLanguageChosen } from "@/components/page-language"
import type { Language } from "@/lib/language"
import type { CachedPublicPath } from "@/lib/language-state"
import { cn } from "@/lib/utils"

import { BrandMenu } from "./brand-menu"
import { BADGE_TEXT, BRAND_COPY, HOME_URL, type BadgeVariant, type BrandCopy } from "./copy"
import { LanguagePrompt } from "./language-prompt"
import "@/components/guided-form/guided-form.css"

export type BrandTopBarProps = {
  /** "schools" on parent-facing pages, "complex" on staff- and agent-facing ones. */
  variant: BadgeVariant
  language: Language
  /** When given, the menu offers "Futa fomu yote" and calls this after the visitor confirms. */
  onClearForm?: () => void
  /** Overrides for the words in `BRAND_COPY[language]`. */
  labels?: Partial<BrandCopy>
  /** Show the first-visit language card (pass `await languagePromptNeeded()`). */
  showLanguagePrompt?: boolean
  /** The menu button, if the page needs it too (e.g. its own `LanguagePrompt`). */
  menuButtonRef?: RefObject<HTMLButtonElement | null>
  /** On a page served from Vercel's cache, its public address (see `BrandMenu`). */
  returnTo?: CachedPublicPath
  className?: string
}

/**
 * The bar above the card on public form pages: the round logo linking to
 * alrahmahcomplex.or.tz, the indigo badge, and the menu that holds the
 * language control. Grid 44px | 1fr | 44px. It also keeps `<html lang>` in
 * step with the page, as `LanguageSwitch` did.
 */
export function BrandTopBar({
  variant,
  language,
  onClearForm,
  labels,
  showLanguagePrompt = false,
  menuButtonRef,
  returnTo,
  className,
}: BrandTopBarProps) {
  // A pick made on this page load set the cookie, so a copy built for no
  // cookie, brought back from the router's cache, doesn't ask again.
  const chosen = useLanguageChosen()
  const ownRef = useRef<HTMLButtonElement | null>(null)
  const buttonRef = menuButtonRef ?? ownRef
  const words = { ...BRAND_COPY[language], ...labels }

  return (
    <header className={cn("gf-top", className)}>
      <DocumentLanguage language={language} />
      <a className="gf-mark-link" href={HOME_URL} aria-label={words.home}>
        <Image className="gf-mark" src="/brand/logo-round.png" alt="" width={44} height={44} priority />
      </a>
      <span
        className={cn(
          "inline-flex h-11 max-w-full items-center justify-self-center rounded-full bg-blue-600 px-5 font-exo text-[15px] font-extrabold tracking-[1px] whitespace-nowrap text-white uppercase italic shadow-sm",
          "max-[380px]:px-3.5 max-[380px]:text-[13px] max-[380px]:tracking-[0.5px]",
          "max-[330px]:px-2.5 max-[330px]:text-[11px] max-[330px]:tracking-[0.3px]",
          "max-[300px]:px-2 max-[300px]:text-[10px] max-[300px]:tracking-normal",
        )}
      >
        {BADGE_TEXT[variant]}
      </span>
      <BrandMenu language={language} labels={words} onClearForm={onClearForm} buttonRef={buttonRef} returnTo={returnTo} />
      {/* Always mounted: it reads `show` once, so the cookie that setLanguage sets
          mid-confirmation doesn't cut the confirmation or the shrink short. */}
      <LanguagePrompt show={showLanguagePrompt && !chosen} language={language} menuButtonRef={buttonRef} />
    </header>
  )
}
