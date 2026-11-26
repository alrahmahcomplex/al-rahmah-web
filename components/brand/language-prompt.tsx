"use client"

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { setLanguage } from "@/app/actions/language"
import { Icon } from "@/components/guided-form/icons"
import { prefersReducedMotion } from "@/components/guided-form/motion"
import { storeLanguage, useChooseLanguage } from "@/components/page-language"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { catchMenuButton } from "./brand-menu"
import { LANGUAGE_PROMPT_COPY, LANGUAGE_PROMPT_PICKS } from "./copy"
import "@/components/guided-form/guided-form.css"

export type LanguagePromptProps = {
  /** True when the request had no `lang` cookie (see `languagePromptNeeded`). Read once, on mount. */
  show: boolean
  /** The page's current language. */
  language: Language
  /** The top bar's menu button: the card grows out of it and shrinks back into it. */
  menuButtonRef: RefObject<HTMLButtonElement | null>
  /** On a page served from Vercel's cache: the pick changes the words in place (components/page-language.tsx). */
  inPlace?: boolean
}

function towardButton(card: HTMLElement, button: HTMLElement | null) {
  if (!button) return { dx: 0, dy: -window.innerHeight / 3 }
  const b = button.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  return { dx: b.left + b.width / 2 - (c.left + c.width / 2), dy: b.top + b.height / 2 - (c.top + c.height / 2) }
}

function canAnimate(el: HTMLElement | null): el is HTMLElement {
  return !!el && typeof el.animate === "function"
}

/**
 * The first-visit language card. It grows out of the menu button over a
 * frosted indigo backdrop and asks in Swahili: "Endelea kwa Kiswahili" or
 * "Continue in English". It waits for a pick however long that takes: there
 * is no countdown, and a tap outside the card or Escape leaves it open. A pick
 * sets the `lang` cookie through `setLanguage` and the card shrinks straight
 * back into the menu button, which pops. It stays mounted through the
 * re-render `setLanguage` causes.
 */
export function LanguagePrompt({ show, menuButtonRef, inPlace = false }: LanguagePromptProps) {
  const chooseLanguage = useChooseLanguage()
  // The server stops sending `show` once the cookie is set, mid-fold; the card finishes anyway.
  // Opened after hydration, so no unusable modal sits in the page before its script runs.
  const [open, setOpen] = useState(false)
  const shown = useRef(show)
  useEffect(() => {
    if (shown.current) setOpen(true)
  }, [])
  const [visible, setVisible] = useState(false)

  const card = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const firstPick = useRef<HTMLButtonElement>(null)
  const closing = useRef(false)

  const finish = useCallback(() => {
    const el = card.current
    const hadFocus = !!el && el.contains(document.activeElement)
    setVisible(false)
    const done = () => {
      setOpen(false)
      document.documentElement.style.overflow = ""
      if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur()
      catchMenuButton(menuButtonRef.current)
    }
    if (!canAnimate(el)) return done()
    let exit: Animation
    if (prefersReducedMotion()) {
      exit = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" })
    } else {
      const { dx, dy } = towardButton(el, menuButtonRef.current)
      inner.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" })
      exit = el.animate(
        [
          { transform: "none", borderRadius: "28px", opacity: 1 },
          { transform: "scale(1.04)", borderRadius: "32px", opacity: 1, offset: 0.16 },
          { transform: "scale(0.4)", borderRadius: "50%", opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.05)`, borderRadius: "50%", opacity: 0.5 },
        ],
        { duration: 720, easing: "cubic-bezier(.5,0,.7,.4)", fill: "forwards" },
      )
    }
    exit.onfinish = done
  }, [menuButtonRef])

  const pick = (lang: Language) => {
    if (closing.current) return
    closing.current = true

    const data = new FormData()
    data.set("lang", lang)
    startTransition(async () => {
      // If the cookie doesn't stick, the card shows again next visit. Nothing to tell the visitor now.
      if (inPlace) {
        // A page served from Vercel's cache shows the pick from here.
        const shown = await storeLanguage(lang)
        if (shown) chooseLanguage(shown)
        return
      }
      try {
        await setLanguage(data)
      } catch {
        return
      }
      chooseLanguage(lang)
    })
    finish()
  }

  // Grow out of the menu button.
  useLayoutEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.style.overflow = "hidden"
    // Measured and placed this frame; the backdrop fades in from the next one.
    const reveal = requestAnimationFrame(() => setVisible(true))
    firstPick.current?.focus({ preventScroll: true })
    const el = card.current
    if (canAnimate(el)) {
      if (prefersReducedMotion()) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
      } else {
        const { dx, dy } = towardButton(el, menuButtonRef.current)
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, borderRadius: "50%", opacity: 0 },
            { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(0.28)`, borderRadius: "50%", opacity: 1, offset: 0.3 },
            { transform: "translate(0, 0) scale(1.05)", borderRadius: "34px", offset: 0.72 },
            { transform: "scale(0.985)", borderRadius: "28px", offset: 0.86 },
            { transform: "none", borderRadius: "28px", opacity: 1 },
          ],
          { duration: 900, easing: "cubic-bezier(.25,.8,.3,1)" },
        )
        inner.current?.animate([{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 420, easing: "ease-out", fill: "backwards" })
      }
    }
    return () => {
      cancelAnimationFrame(reveal)
      root.style.overflow = ""
    }
    // Runs once per opening; the ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const words = LANGUAGE_PROMPT_COPY

  return (
    <div className={cn("gf-lp", visible && "gf-on", !visible && "pointer-events-none")}>
      {/* A tap here does nothing: only a pick closes the card. */}
      <div className="gf-lp-back" aria-hidden="true" />
      <div
        ref={card}
        className="gf-lp-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gf-lp-h"
        aria-describedby="gf-lp-d"
        lang="sw"
        style={visible ? undefined : { opacity: 0 }}
        onKeyDown={(e) => {
          // Escape leaves the card open too.
          if (e.key === "Escape") return e.preventDefault()
          if (e.key !== "Tab") return
          e.preventDefault()
          const picks = [...(card.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? [])]
          const i = picks.indexOf(document.activeElement as HTMLElement)
          picks[(i + (e.shiftKey ? -1 : 1) + picks.length) % picks.length]?.focus()
        }}
      >
        <div ref={inner} className="gf-lp-in">
          <span className="gf-lp-globe">
            <Icon name="globe" />
          </span>
          <h2 id="gf-lp-h" className="m-0 font-exo text-2xl leading-[1.15] font-extrabold text-blue-600 italic">
            {words.heading}
          </h2>
          <p id="gf-lp-d" className="m-0 text-sm leading-[1.45] text-slate-600">
            {words.body}
          </p>
          <div className="gf-lp-act">
            <div className="gf-lp-btns flex w-full flex-col gap-2.5">
              {(["sw", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  ref={lang === "sw" ? firstPick : undefined}
                  type="button"
                  lang={lang}
                  data-pick={lang}
                  onClick={() => pick(lang)}
                  className={cn(
                    "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full px-6 font-exo text-[17px] font-bold italic outline-none select-none focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)",
                    lang === "sw" ? "gf-go bg-orange-500 text-white hover:bg-orange-600" : "border-[1.5px] border-blue-600/22 bg-transparent text-blue-600 hover:bg-blue-50 active:scale-[0.96]",
                  )}
                >
                  <span>{LANGUAGE_PROMPT_PICKS[lang]}</span>
                  <Icon name="right" className="gf-chev" />
                </button>
              ))}
            </div>
          </div>
          <div className="gf-lp-hint">
            <p>{words.hint}</p>
            <div className="gf-ld" aria-hidden="true">
              <span className="gf-ld-time">9:41</span>
              <span className="gf-ld-bat" />
              <div className="gf-ld-bar">
                <span className="gf-ld-logo" />
                <span className="gf-ld-badge" />
                <span className="gf-ld-btn">
                  <Icon name="menu" />
                </span>
              </div>
              <span className="gf-ld-tap" />
              <div className="gf-ld-menu">
                <div className="gf-ld-seg">
                  <i />
                  <b>Kiswahili</b>
                  <b>English</b>
                </div>
                <span className="gf-ld-line" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
