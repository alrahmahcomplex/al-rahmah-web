"use client"

import { useEffect, useImperativeHandle, useRef, type Ref } from "react"

// Cloudflare Turnstile's check on a public form, rendered explicitly so it can
// mount on a later step (#9). Inside a <form> it adds the hidden
// `cf-turnstile-response` field that the Server Action passes to
// `verifyTurnstile`. Only the public site key is used here; the secret stays
// in lib/turnstile.ts on the server.

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
  size: "flexible"
  theme: "auto"
  language: string
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
}

export function TurnstileWidget({
  action,
  language,
  ref,
}: {
  // Per form, and checked on the server: "admission", "agent".
  action: string
  // The page language, such as "sw" or "en".
  language: string
  ref?: Ref<TurnstileWidgetHandle>
}) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  useImperativeHandle(ref, () => ({
    reset() {
      if (widget.current) widget.current.turnstile.reset(widget.current.id)
    },
  }))

  useEffect(() => {
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
          size: "flexible",
          theme: "auto",
          language: WIDGET_LANGUAGES.has(language) ? language : "auto",
          "expired-callback": reset,
          "timeout-callback": reset,
        })
        if (id) widget.current = { turnstile, id }
      })
      .catch((error: unknown) => console.error(error))

    return () => {
      cancelled = true
      if (widget.current) {
        widget.current.turnstile.remove(widget.current.id)
        widget.current = null
      }
    }
  }, [siteKey, action, language])

  // Turnstile's flexible size is the container's full width and 65px tall;
  // reserving the height stops the page jumping when it appears.
  return <div ref={container} className="min-h-[65px] w-full" />
}
