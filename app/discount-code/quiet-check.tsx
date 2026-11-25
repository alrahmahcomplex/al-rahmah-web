"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ContinuePill, NoticeBox } from "@/components/guided-form"
import { TurnstileWidget, type CheckStatus, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { Language } from "@/lib/language"

// The security check on the agent sign-up's two sends, Send and Set password
// (owner, prototype v5, 25 Nov 2026). Normally nobody sees it: it finishes
// while the form is filled in. Tapped before it has, the button just shows
// "Sending…" ("Saving…") and the form goes on by itself once it passes.
// Only a slow check (20 seconds) or one that didn't load says anything, and
// then it says what to do: press Run the check again, which draws the check
// again in place, with everything typed kept.

// How long the button may wait on the check before the form says it's slow.
export const SLOW_CHECK_MS = 20_000

export type CheckProblem = "slow" | "failed" | "failed-again"

export const CHECK_COPY: Record<Language, Record<CheckProblem | "again", string>> = {
  sw: {
    slow: "Ukaguzi wa usalama unachukua muda mrefu kuliko kawaida. Bonyeza kitufe hapa chini kurudia ukaguzi. Ulichojaza kimehifadhiwa, hutahitaji kuandika taarifa zako upya.",
    failed: "Ukaguzi wa usalama haukufunguka. Bonyeza kitufe hapa chini kurudia ukaguzi. Ulichojaza kimehifadhiwa, hutahitaji kuandika taarifa zako upya.",
    "failed-again":
      "Ukaguzi wa usalama bado haufunguki. Hakikisha una mtandao, kisha bonyeza kitufe hapa chini kurudia ukaguzi, au piga simu ofisini. Ulichojaza kimehifadhiwa, hutahitaji kuandika taarifa zako upya.",
    again: "Rudia ukaguzi",
  },
  en: {
    slow: "The security check is taking longer than usual. Press the button below to run the check again. Your progress is saved, so you won't have to enter your details from scratch.",
    failed: "The security check didn't load. Press the button below to run the check again. Your progress is saved, so you won't have to enter your details from scratch.",
    "failed-again":
      "The security check still didn't load. Check your internet connection, then press the button below to run it again, or call the office. Your progress is saved, so you won't have to enter your details from scratch.",
    again: "Run the check again",
  },
}

/**
 * The check's state for one send. `begin(send)` is called when the person
 * sends before there is a token: `send` runs by itself once one comes.
 * `token()` is the latest token (Cloudflare also puts it in the form's
 * hidden field). `waiting` is true from `begin` until the send goes on.
 */
export function useQuietCheck() {
  const widget = useRef<TurnstileWidgetHandle>(null)
  const status = useRef<CheckStatus>("checking")
  const token = useRef<string | null>(null)
  const pendingSend = useRef<(() => void) | null>(null)
  const slowTimer = useRef<number | undefined>(undefined)
  // Run the check again was pressed: a failure after it says so.
  const retried = useRef(false)
  const [waiting, setWaiting] = useState(false)
  const [problem, setProblem] = useState<CheckProblem | null>(null)

  const startSlowTimer = useCallback(() => {
    window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => {
      // Cloudflare's own box asking for a click is the instruction then.
      if (status.current === "checking") setProblem("slow")
    }, SLOW_CHECK_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(slowTimer.current), [])

  const onStatus = useCallback((next: CheckStatus, value: string | null) => {
    status.current = next
    token.current = next === "ready" ? value : null
    if (next === "ready") {
      window.clearTimeout(slowTimer.current)
      setProblem(null)
      const send = pendingSend.current
      pendingSend.current = null
      if (send) {
        setWaiting(false)
        // After this render, so the token is in the form's field too.
        window.setTimeout(send, 0)
      }
      return
    }
    if (!pendingSend.current) return
    if (next === "failed" || next === "unsupported") {
      window.clearTimeout(slowTimer.current)
      setProblem(retried.current ? "failed-again" : "failed")
    } else if (next === "needsClick") {
      window.clearTimeout(slowTimer.current)
      setProblem(null)
      widget.current?.reveal()
    }
  }, [])

  const begin = useCallback(
    (send: () => void) => {
      pendingSend.current = send
      setWaiting(true)
      if (status.current === "failed" || status.current === "unsupported") return setProblem(retried.current ? "failed-again" : "failed")
      setProblem(null)
      if (status.current === "needsClick") widget.current?.reveal()
      else startSlowTimer()
    },
    [startSlowTimer],
  )

  const retry = useCallback(() => {
    retried.current = true
    setProblem(null)
    widget.current?.redraw()
    if (pendingSend.current) startSlowTimer()
  }, [startSlowTimer])

  // A send that came back without a confirmation: the token is spent.
  const reset = useCallback(() => {
    token.current = null
    widget.current?.reset()
  }, [])

  // The form was cleared or left: nothing goes on by itself any more.
  const cancel = useCallback(() => {
    pendingSend.current = null
    window.clearTimeout(slowTimer.current)
    setWaiting(false)
    setProblem(null)
  }, [])

  // The widget hands its handle over here (a callback ref, so the hook's
  // result holds no ref the page could read during render).
  const bindWidget = useCallback((handle: TurnstileWidgetHandle | null) => {
    widget.current = handle
  }, [])

  const readToken = useCallback(() => token.current, [])

  return { bindWidget, onStatus, begin, retry, reset, cancel, waiting, problem, token: readToken }
}

/**
 * The check itself, invisible unless Cloudflare needs a click, then the slow
 * or failed message with its Run the check again button. Put it inside the
 * form, just above the send button.
 */
export function QuietCheck({
  check,
  language,
  className,
}: {
  check: Pick<ReturnType<typeof useQuietCheck>, "bindWidget" | "onStatus" | "problem" | "retry">
  language: Language
  className?: string
}) {
  const { bindWidget, onStatus, problem, retry } = check
  return <CheckParts bind={bindWidget} onStatus={onStatus} problem={problem} onRetry={retry} language={language} className={className} />
}

function CheckParts({
  bind,
  onStatus,
  problem,
  onRetry,
  language,
  className,
}: {
  bind: (handle: TurnstileWidgetHandle | null) => void
  onStatus: (status: CheckStatus, token: string | null) => void
  problem: CheckProblem | null
  onRetry: () => void
  language: Language
  className?: string
}) {
  const words = CHECK_COPY[language]
  return (
    <>
      <TurnstileWidget ref={bind} action="agent" language={language} quiet onStatus={onStatus} className={className} />
      {problem && (
        <div className="flex w-full flex-col gap-3" data-check-problem={problem}>
          <NoticeBox role="alert" tone={problem === "slow" ? "wait" : "bad"} icon={problem === "slow" ? "clock" : "alert"}>
            {words[problem]}
          </NoticeBox>
          <ContinuePill variant="ghost" icon="reset" onClick={onRetry}>
            {words.again}
          </ContinuePill>
        </div>
      )}
    </>
  )
}
