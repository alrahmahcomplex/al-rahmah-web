"use client"

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"

import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

// Cloudflare Turnstile's check on a public form, rendered explicitly so it can
// mount on a later step (#9). Inside a <form> it adds the hidden
// `cf-turnstile-response` field that the Server Action passes to
// `verifyTurnstile`, so keep it inside the form. It stays invisible unless
// Cloudflare needs the person to click; put it just above the send button so
// that rare box sits where the person is looking. Only the public site key is
// used here; the secret stays in lib/turnstile.ts on the server.

// Loaded straight from Cloudflare: proxying or caching it breaks Turnstile
// when Cloudflare updates it.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

// The two-letter codes Turnstile offers
// (developers.cloudflare.com/turnstile/reference/supported-languages, read
// 2026-10-01). Swahili isn't one, so a Swahili page gets `auto`: the visitor's
// browser language when Turnstile has it, English otherwise.
const WIDGET_LANGUAGES = new Set(
  "ar bg zh hr cs da nl en fa fi fr de el he hi hu id it ja ko lt ms nb pl pt ro ru sr sk sl es sv tl th tr uk vi".split(" "),
)

type RenderOptions = {
  sitekey: string
  action: string
  size: "flexible" | "compact"
  theme: "auto"
  appearance: "interaction-only"
  language: string
  callback: () => void
  "before-interactive-callback": () => void
  "error-callback": () => boolean
  "unsupported-callback": () => void
  "expired-callback": () => void
  "timeout-callback": () => void
}

type Turnstile = {
  render(container: HTMLElement, options: RenderOptions): string | undefined
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

// Turnstile's flexible size is never narrower than this; below it the
// compact size (150px wide) fits instead.
const FLEXIBLE_MIN_WIDTH = 300

const COPY: Record<Language, Record<"needsClick" | "failed", string>> = {
  sw: {
    needsClick: "Weka alama kwenye ukaguzi wa usalama hapa chini, kisha utume.",
    failed: "Ukaguzi wa usalama haukuweza kufunguka. Pakia ukurasa upya kisha ujaribu tena.",
  },
  en: {
    needsClick: "Tick the security check below, then send.",
    failed: "The security check couldn't load. Reload the page and try again.",
  },
}

let loading: Promise<Turnstile> | null = null

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    // On failure, let a later mount try again.
    const fail = (message: string) => {
      loading = null
      script.remove()
      reject(new Error(message))
    }
    script.addEventListener("load", () => {
      if (window.turnstile) resolve(window.turnstile)
      else fail("Turnstile's script loaded without defining window.turnstile")
    })
    script.addEventListener("error", () => fail("Turnstile's script failed to load"))
    document.head.appendChild(script)
  })
  return loading
}

export type TurnstileWidgetHandle = {
  // Gets a fresh token. Call it after any server answer that isn't a
  // confirmation: a token is spent once Cloudflare has checked it.
  reset(): void
  // Call it when the form is sent without a token. When the check needs the
  // person (or failed to load), scrolls it into view, moves focus to its
  // message and returns true, so the form can skip its own "wait" notice.
  reveal(): boolean
}

type CheckState = "hidden" | "needsClick" | "failed"

export function TurnstileWidget({
  action,
  language,
  className,
  ref,
}: {
  // Per form, and checked on the server: "admission", "agent".
  action: string
  // The page language.
  language: Language
  // Spacing around the check, used only while it shows.
  className?: string
  ref?: Ref<TurnstileWidgetHandle>
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const message = useRef<HTMLParagraphElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)
  const [state, setState] = useState<CheckState>("hidden")
  const stateRef = useRef<CheckState>("hidden")
  // Measured before the widget is drawn, and again when the space crosses
  // 300px (a phone turning, a window narrowing): the widget is then drawn
  // again at the size that fits.
  const [size, setSize] = useState<"flexible" | "compact" | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  function show(next: CheckState) {
    stateRef.current = next
    setState(next)
  }

  useImperativeHandle(ref, () => ({
    reset() {
      if (widget.current) widget.current.turnstile.reset(widget.current.id)
    },
    reveal() {
      if (stateRef.current === "hidden") return false
      wrapper.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      message.current?.focus({ preventScroll: true })
      return true
    },
  }))

  useEffect(() => {
    const box = container.current
    if (!box) return
    const measure = () => setSize(box.clientWidth < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible")
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size) return
    if (!siteKey) {
      console.error("Turnstile: NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set, so the form can't be sent")
      return
    }
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        const reset = () => {
          if (widget.current) turnstile.reset(widget.current.id)
        }
        const id = turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          // The sign-in card is narrower than flexible's minimum.
          size,
          theme: "auto",
          // Invisible unless Cloudflare needs the person to click: a
          // box near the fee read like a payment confirmation.
          appearance: "interaction-only",
          language: WIDGET_LANGUAGES.has(language) ? language : "auto",
          callback: () => show("hidden"),
          "before-interactive-callback": () => show("needsClick"),
          // Returning true tells Turnstile the error is handled; it still
          // retries on its own, and a later success clears the message.
          "error-callback": () => {
            show("failed")
            return true
          },
          "unsupported-callback": () => show("failed"),
          "expired-callback": reset,
          "timeout-callback": reset,
        })
        if (id) widget.current = { turnstile, id }
      })
      .catch((error: unknown) => {
        console.error(error)
        if (!cancelled) show("failed")
      })

    return () => {
      cancelled = true
      if (widget.current) {
        widget.current.turnstile.remove(widget.current.id)
        widget.current = null
      }
      // A widget drawn again starts with no message.
      show("hidden")
    }
  }, [siteKey, action, language, size])

  const text = state === "hidden" ? "" : COPY[language][state]

  // The live region is always there, so a message added later is read out.
  return (
    <div ref={wrapper} className={cn("flex w-full flex-col items-center gap-2", state !== "hidden" && className)}>
      <p
        ref={message}
        tabIndex={-1}
        aria-live={state === "failed" ? "assertive" : "polite"}
        className={cn("text-center text-sm outline-none", state === "failed" ? "text-red-700" : "text-slate-700", !text && "sr-only")}
      >
        {text}
      </p>
      <div ref={container} data-turnstile-box className="flex w-full justify-center" />
    </div>
  )
}
