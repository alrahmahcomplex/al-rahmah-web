"use client"

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { setLanguage } from "@/app/actions/language"
import { Icon } from "@/components/guided-form/icons"
import { prefersReducedMotion } from "@/components/guided-form/motion"
import { useChooseLanguage } from "@/components/page-language"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { catchMenuButton } from "./brand-menu"
import { LANGUAGE_PROMPT_COPY, LANGUAGE_PROMPT_PICKS } from "./copy"
import "@/components/guided-form/guided-form.css"

const ASK_MS = 5000
const CONFIRM_MS = 3000
const TICK_MS = 50

export type LanguagePromptProps = {
  /** True when the request had no `lang` cookie (see `languagePromptNeeded`). Read once, on mount. */
  show: boolean
  /** The page's current language. */
  language: Language
  /** The top bar's menu button: the card grows out of it and shrinks back into it. */
  menuButtonRef: RefObject<HTMLButtonElement | null>
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
 * "Continue in English". A pick (or 5 seconds untouched, or Escape) sets the
 * `lang` cookie through `setLanguage`, shows a 3-second confirmation while the
 * phone picture plays once, then the card shrinks back into the menu button,
 * which pops. Hover, a finger on the card or the keyboard stops the 5 seconds.
 * It stays mounted through the re-render `setLanguage` causes.
 */
export function LanguagePrompt({ show, menuButtonRef }: LanguagePromptProps) {
  // The server stops sending `show` once the cookie is set, mid-confirmation; the card finishes anyway.
  // Opened after hydration, so no unusable modal sits in the page before its script runs.
  const chooseLanguage = useChooseLanguage()
  const [open, setOpen] = useState(false)
  const shown = useRef(show)
  useEffect(() => {
    if (shown.current) setOpen(true)
  }, [])
  const [stage, setStage] = useState<"ask" | "confirm">("ask")
  const [cardLang, setCardLang] = useState<Language>("sw")
  const [picked, setPicked] = useState<Language | null>(null)
  const [running, setRunning] = useState(false)
  const [visible, setVisible] = useState(false)
  const [timerStopped, setTimerStopped] = useState(false)

  const card = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const timerBar = useRef<HTMLElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const firstPick = useRef<HTMLButtonElement>(null)
  const left = useRef(ASK_MS)
  const hover = useRef(false)
  const held = useRef(false)
  const stageRef = useRef<"ask" | "confirm" | "closing">("ask")
  const ticker = useRef(0)
  const timeouts = useRef<number[]>([])

  const later = (fn: () => void, ms: number) => {
    timeouts.current.push(window.setTimeout(fn, ms))
  }

  const stopTicker = () => window.clearInterval(ticker.current)

  const finish = useCallback(() => {
    if (stageRef.current === "closing") return
    stageRef.current = "closing"
    stopTicker()
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

  const confirm = useCallback(
    (lang: Language) => {
      if (stageRef.current !== "ask") return
      stageRef.current = "confirm"
      stopTicker()
      setTimerStopped(true)
      setStage("confirm")

      const data = new FormData()
      data.set("lang", lang)
      startTransition(async () => {
        try {
          await setLanguage(data)
        } catch {
          // The cookie didn't stick; the card shows again next visit. Nothing to tell the visitor now.
          return
        }
        // A page served from Vercel's cache shows the pick from here; others re-render with it too.
        chooseLanguage(lang)
      })

      const swap = () => {
        setCardLang(lang)
        setPicked(lang)
        later(() => setRunning(true), 20)
        later(finish, CONFIRM_MS)
      }
      const el = inner.current
      if (prefersReducedMotion() || !canAnimate(el)) return swap()
      const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" })
      fade.onfinish = () => {
        swap()
        fade.cancel()
        el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" })
      }
    },
    [finish, chooseLanguage],
  )

  // Grow out of the menu button, then start the 5 seconds.
  useLayoutEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.style.overflow = "hidden"
    // Measured and placed this frame; the backdrop fades in from the next one.
    const reveal = requestAnimationFrame(() => setVisible(true))
    firstPick.current?.focus({ preventScroll: true })
    const startTimer = () => {
      window.clearInterval(ticker.current)
      ticker.current = window.setInterval(() => {
        if (stageRef.current !== "ask") return stopTicker()
        if (!hover.current && !held.current) left.current -= TICK_MS
        if (timerBar.current) timerBar.current.style.transform = `scaleX(${Math.max(0, left.current / ASK_MS)})`
        if (left.current <= 0) confirm("sw")
      }, TICK_MS)
    }
    const el = card.current
    if (!canAnimate(el)) {
      startTimer()
    } else {
      let enter: Animation
      if (prefersReducedMotion()) {
        enter = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
      } else {
        const { dx, dy } = towardButton(el, menuButtonRef.current)
        enter = el.animate(
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
      enter.onfinish = startTimer
    }
    const pending = timeouts.current
    return () => {
      cancelAnimationFrame(reveal)
      window.clearInterval(ticker.current)
      pending.forEach((t) => window.clearTimeout(t))
      root.style.overflow = ""
    }
    // Runs once per opening; `confirm` and the ref are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The confirmation takes focus so a screen reader hears it.
  useEffect(() => {
    if (picked) status.current?.focus({ preventScroll: true })
  }, [picked])

  if (!open) return null

  const words = LANGUAGE_PROMPT_COPY[cardLang]
  const stopTimer = () => {
    held.current = true
    setTimerStopped(true)
  }
  const dismiss = () => (stageRef.current === "ask" ? confirm("sw") : finish())

  return (
    <div className={cn("gf-lp", visible && "gf-on", !visible && "pointer-events-none")}>
      <div className="gf-lp-back" onClick={dismiss} aria-hidden="true" />
      <div
        ref={card}
        className="gf-lp-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gf-lp-h"
        aria-describedby="gf-lp-d"
        lang={cardLang}
        style={visible ? undefined : { opacity: 0 }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") hover.current = true
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hover.current = false
        }}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("[data-pick]")) stopTimer()
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            dismiss()
            return
          }
          if (e.key !== "Tab") return
          e.preventDefault()
          if (stage !== "ask") return
          stopTimer()
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
            {stage === "ask" || !picked ? (
              <div className="gf-lp-btns flex w-full flex-col gap-2.5">
                {(["sw", "en"] as const).map((lang) => (
                  <button
                    key={lang}
                    ref={lang === "sw" ? firstPick : undefined}
                    type="button"
                    lang={lang}
                    data-pick={lang}
                    onClick={() => confirm(lang)}
                    className={cn(
                      "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full px-6 font-exo text-[17px] font-bold italic outline-none select-none focus-visible:ring-3 focus-visible:ring-blue-600/40",
                      lang === "sw" ? "gf-go bg-orange-500 text-white hover:bg-orange-600" : "border-[1.5px] border-blue-600/22 bg-transparent text-blue-600 hover:bg-blue-50 active:scale-[0.96]",
                    )}
                  >
                    <span>{LANGUAGE_PROMPT_PICKS[lang]}</span>
                    <Icon name="right" className="gf-chev" />
                  </button>
                ))}
              </div>
            ) : (
              <div ref={status} role="status" tabIndex={-1} className="gf-lp-status flex flex-col gap-3 rounded-[18px] border-[1.5px] border-blue-600/22 bg-white px-3.5 py-4">
                <p className="m-0 flex items-center justify-center gap-2.5 text-left text-[15px] leading-[1.35] font-semibold text-blue-600">
                  <span className="grid flex-none" data-icon={picked === "en" ? "spinner" : "tick"}>
                    {picked === "en" ? (
                      <span className="gf-lp-spin" />
                    ) : (
                      <span className="gf-lp-ok">
                        <Icon name="check" />
                      </span>
                    )}
                  </span>
                  <span>{words.status}</span>
                </p>
                <span className={cn("gf-lp-prog", running && "gf-run")}>
                  <i />
                </span>
              </div>
            )}
          </div>
          <div className="gf-lp-hint">
            <p>{words.hint}</p>
            <div className={cn("gf-ld", picked && "gf-go", picked && `gf-go-${picked}`)} aria-hidden="true">
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
        <span className={cn("gf-lp-timer", timerStopped && "gf-stop")} aria-hidden="true">
          <i ref={timerBar} />
        </span>
      </div>
    </div>
  )
}
