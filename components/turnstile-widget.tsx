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
  size: Size
  theme: "auto"
  appearance: "interaction-only"
  language: string
  callback: () => void
  "before-interactive-callback": () => void
  "error-callback": (code: string) => boolean
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

// A single error is often a network blip that Turnstile's own retry clears
// (it waits 8 seconds by default), so "couldn't load" shows only after a
// second error in a row, or when no retry has worked this long after the
// first. Some errors, such as a wrong site key, are never retried.
const RETRY_GRACE_MS = 15_000

type Size = "flexible" | "compact"

type CheckState = "hidden" | "needsClick" | "failed" | "unsupported"

const COPY: Record<Language, Record<Exclude<CheckState, "hidden">, string>> = {
  sw: {
    needsClick: "Weka alama kwenye ukaguzi wa usalama hapa chini, kisha utume.",
    failed: "Ukaguzi wa usalama haukuweza kufunguka. Pakia ukurasa upya kisha ujaribu tena.",
    unsupported: "Kivinjari hiki hakiwezi kufanya ukaguzi wa usalama. Jaribu kivinjari kingine, au piga simu ofisini.",
  },
  en: {
    needsClick: "Tick the security check below, then send.",
    failed: "The security check couldn't load. Reload the page and try again.",
    unsupported: "This browser can't run the security check. Try another browser, or call the office.",
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
  const prompt = useRef<HTMLParagraphElement>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)
  const [state, setState] = useState<CheckState>("hidden")
  const stateRef = useRef<CheckState>("hidden")
  // Once Cloudflare has shown the box, its spacing stays until the widget is
  // drawn again: the box stays on screen after a tick, showing success.
  const [shown, setShown] = useState(false)
  const shownRef = useRef(false)
  // The size the widget is drawn at. Measured before it is first drawn, and
  // again when the space crosses 300px (a phone turning, a window
  // narrowing). A box on screen is then drawn again at the size that fits,
  // so it never sticks out of the card; that drops a token it held, and
  // Turnstile checks again by itself. An invisible widget keeps its size and
  // its token, since only a box on screen can stick out; if Cloudflare later
  // needs a click or shows an error in the box, a flexible box that no longer
  // fits is drawn again compact first. A compact box is never drawn again
  // wider at that point: it fits wherever flexible does, and growing it there
  // looped near 300px, where the box's own scrollbar narrowed the space and
  // the redraw, invisible for a moment, took the scrollbar away (#278).
  const [size, setSize] = useState<Size | null>(null)
  const fits = useRef<Size | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  function show(next: CheckState) {
    stateRef.current = next
    setState(next)
    if (next !== "hidden") {
      shownRef.current = true
      setShown(true)
    }
  }

  useImperativeHandle(ref, () => ({
    reset() {
      if (widget.current) widget.current.turnstile.reset(widget.current.id)
    },
    reveal() {
      if (stateRef.current === "hidden") return false
      wrapper.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      const message = stateRef.current === "needsClick" ? prompt.current : alert.current
      message?.focus({ preventScroll: true })
      return true
    },
  }))

  useEffect(() => {
    const box = container.current
    if (!box) return
    const measure = () => {
      const next = box.clientWidth < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible"
      fits.current = next
      setSize((current) => (current === null || shownRef.current ? next : current))
    }
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
    let errors = 0
    let grace: ReturnType<typeof setTimeout> | undefined
    const recovered = () => {
      errors = 0
      clearTimeout(grace)
    }
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        const reset = () => {
          if (widget.current) turnstile.reset(widget.current.id)
        }
        // Drawn flexible while invisible, in space that has since dropped
        // under 300px.
        const sticksOut = () => size === "flexible" && fits.current === "compact"
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
          callback: () => {
            recovered()
            show("hidden")
          },
          "before-interactive-callback": () => {
            recovered()
            if (sticksOut()) return setSize("compact")
            show("needsClick")
          },
          // Returning true tells Turnstile the error is handled, which also
          // stops it logging the code, so log it here. Turnstile still
          // retries on its own, and a later success clears the message.
          "error-callback": (code: string) => {
            console.error(`Turnstile error ${code}`)
            // The error may show in the box, so draw it to fit first; the
            // new widget counts its own errors.
            if (sticksOut()) {
              setSize("compact")
              return true
            }
            errors += 1
            clearTimeout(grace)
            if (errors > 1) show("failed")
            else grace = setTimeout(() => show("failed"), RETRY_GRACE_MS)
            return true
          },
          "unsupported-callback": () => show("unsupported"),
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
      clearTimeout(grace)
      if (widget.current) {
        widget.current.turnstile.remove(widget.current.id)
        widget.current = null
      }
      // A widget drawn again starts with no message and no spacing.
      show("hidden")
      shownRef.current = false
      setShown(false)
    }
  }, [siteKey, action, language, size])

  const needsClick = state === "needsClick"
  const problem = state === "failed" || state === "unsupported"

  // The polite region is always there, so a prompt added later is read out.
  // A problem is added as role="alert", which is announced when it appears.
  return (
    <div ref={wrapper} className={cn("flex w-full flex-col items-center gap-2", shown && className)}>
      <p
        ref={prompt}
        tabIndex={-1}
        aria-live="polite"
        className={cn("text-center text-sm text-slate-700 outline-none", !needsClick && "sr-only")}
      >
        {needsClick ? COPY[language].needsClick : ""}
      </p>
      {problem && (
        <p ref={alert} tabIndex={-1} role="alert" className="text-center text-sm text-red-700 outline-none">
          {COPY[language][state]}
        </p>
      )}
      <div ref={container} data-turnstile-box className="flex w-full justify-center" />
    </div>
  )
}
