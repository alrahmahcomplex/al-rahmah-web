"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"

import { prefersReducedMotion } from "./motion"
import "./confirmation-number.css"

// The confirmation-number boxes (#503, prototype v57, Design system →
// Inputs): six boxes for a number sent by SMS. They send themselves on the
// sixth digit, or on a paste or SMS autofill, which spreads across the boxes.
// Focus never skips ahead. A right number turns the boxes green one by one,
// then they slide together into the outline circle with a faint green body,
// which draws itself before its tick (prototype v60); a wrong one turns them
// red, shakes them and ends in the same circle in red with a cross. With
// reduced motion the finished mark shows at once. The page shows the note under them and calls
// reset() for another try. No words live here: pass both labels.

const LENGTH = 6
const EMPTY = Array<string>(LENGTH).fill("")

export type ConfirmationResult = "ok" | "bad"

// How long after the boxes merge the result counts as landed, in ms. A right
// number waits for its whole mark: the circle draws from 200 to 820 and the
// tick from 680 to 1060 (confirmation-number.css), so the page never moves on
// before the tick is seen. A wrong one settles as the cross starts, so its
// note shows while the cross draws. Reduced motion has no drawing.
export function settleAfter(result: ConfirmationResult, reducedMotion: boolean): number {
  if (reducedMotion) return 300
  return result === "ok" ? 1120 : 420
}

export type ConfirmationNumberProps = {
  /** The group's name for screen readers, e.g. "Namba ya kuthibitisha". */
  label: string
  /** Each box's name, e.g. (n) => `Tarakimu ${n} kati ya 6`. */
  digitLabel: (n: number) => string
  /** Checks the six digits; the boxes stay locked until it answers. */
  onComplete: (code: string) => Promise<ConfirmationResult>
  /** After the tick or the cross has landed. */
  onSettled?: (result: ConfirmationResult, code: string) => void
  autoFocus?: boolean
  /** Locks the boxes, e.g. while a new number is on its way. */
  disabled?: boolean
  id?: string
}

export type ConfirmationNumberHandle = {
  /** Empties the boxes and, unless told not to, focuses the first. */
  reset: (focus?: boolean) => void
}

type State = "idle" | "checking" | "ok" | "bad"

export const ConfirmationNumber = forwardRef<ConfirmationNumberHandle, ConfirmationNumberProps>(function ConfirmationNumber(
  { label, digitLabel, onComplete, onSettled, autoFocus = false, disabled = false, id },
  ref,
) {
  const [digits, setShownDigits] = useState<string[]>(EMPTY)
  // The digits as they are now: focus moves before React renders the last
  // change, and the focus rule must see it.
  const current = useRef<string[]>(EMPTY)
  const setDigits = (next: string[]) => {
    current.current = next
    setShownDigits(next)
  }
  const [state, setState] = useState<State>("idle")
  const [merged, setMerged] = useState(false)
  const [instant, setInstant] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const row = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  // Each check counts; a reset moves on, so a late answer to an old check
  // never lands on fresh boxes.
  const run = useRef(0)
  const live = useRef(true)
  const locked = state !== "idle" || disabled

  useEffect(() => {
    live.current = true
    const pending = timers.current
    return () => {
      live.current = false
      pending.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus({ preventScroll: true })
  }, [autoFocus])

  // A reset turns transitions off for one frame, so the boxes jump back.
  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(frame)
  }, [instant])

  const later = (ms: number, work: () => void) => {
    timers.current.push(window.setTimeout(() => live.current && work(), ms))
  }

  // Each box slides to the row's middle when they merge into the circle.
  const measureSlide = () => {
    const rowBox = row.current?.getBoundingClientRect()
    if (!rowBox) return
    const middle = rowBox.left + rowBox.width / 2
    for (const box of boxes.current) {
      if (!box) continue
      const own = box.getBoundingClientRect()
      box.style.setProperty("--dx", `${(middle - (own.left + own.width / 2)).toFixed(1)}px`)
    }
  }

  const submit = (code: string) => {
    setState("checking")
    boxes.current.forEach((box) => box?.blur())
    const mine = ++run.current
    const answer = onComplete(code).catch((): ConfirmationResult => "bad")
    void answer.then((result) => {
      if (!live.current || mine !== run.current) return
      setState(result)
      const still = prefersReducedMotion()
      // Green runs box by box (70ms apart); red shakes once. Then they merge.
      const colour = still ? 500 : result === "ok" ? LENGTH * 70 + 260 : 440
      later(colour, () => {
        measureSlide()
        setMerged(true)
        later(settleAfter(result, still), () => onSettled?.(result, code))
      })
    })
  }

  const place = (from: number, typed: string) => {
    const next = [...current.current]
    let at = from
    for (const digit of typed) {
      if (at >= LENGTH) break
      next[at] = digit
      at += 1
    }
    setDigits(next)
    if (next.every(Boolean)) submit(next.join(""))
    else boxes.current[Math.min(at, LENGTH - 1)]?.focus()
  }

  const reset = useCallback((focus = true) => {
    run.current += 1
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setInstant(true)
    setMerged(false)
    setState("idle")
    current.current = EMPTY
    setShownDigits(EMPTY)
    if (focus) requestAnimationFrame(() => boxes.current[0]?.focus())
  }, [])

  useImperativeHandle(ref, () => ({ reset }), [reset])

  const onInput = (index: number) => (event: FormEvent<HTMLInputElement>) => {
    if (locked) return
    const typed = event.currentTarget.value.replace(/\D/g, "")
    const before = current.current[index]
    // SMS autofill, or a run typed or pasted into one box.
    if (typed.length > 2 || (typed.length === 2 && !before)) return place(typed.length >= LENGTH ? 0 : index, typed.slice(0, LENGTH))
    // A digit typed into a box that held one: keep the new one.
    const digit = typed.length === 2 ? (typed[0] === before ? typed[1] : typed[0]) : typed
    if (!digit) {
      const next = [...current.current]
      next[index] = ""
      setDigits(next)
      return
    }
    place(index, digit)
  }

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (locked) return
    if (event.key === "Backspace" && !current.current[index] && index > 0) {
      event.preventDefault()
      const next = [...current.current]
      next[index - 1] = ""
      setDigits(next)
      boxes.current[index - 1]?.focus()
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault()
      boxes.current[index - 1]?.focus()
    } else if (event.key === "ArrowRight" && index < LENGTH - 1) {
      event.preventDefault()
      boxes.current[index + 1]?.focus()
    }
  }

  const onPaste = (index: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (locked) return
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH)
    if (!pasted) return
    place(pasted.length === LENGTH ? 0 : index, pasted)
  }

  // Focus never skips ahead: a later box sends it to the first empty one.
  const onFocus = (index: number) => () => {
    if (locked) return
    const firstEmpty = current.current.findIndex((d) => !d)
    if (firstEmpty >= 0 && firstEmpty < index) {
      boxes.current[firstEmpty]?.focus()
      return
    }
    const box = boxes.current[index]
    window.setTimeout(() => {
      if (box && document.activeElement === box && box.value) box.select()
    }, 0)
  }

  const shown = state === "ok" || state === "bad" ? state : "idle"

  return (
    <div
      className="gf-otp"
      data-state={shown}
      data-merged={merged ? "" : undefined}
      data-instant={instant ? "" : undefined}
      aria-busy={state === "checking" || undefined}
    >
      <div ref={row} className="gf-otp-row" role="group" aria-label={label} id={id}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              boxes.current[index] = el
            }}
            className="gf-otp-box"
            style={{ ["--i" as string]: index }}
            data-filled={digit ? "" : undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={LENGTH}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={digitLabel(index + 1)}
            value={digit}
            readOnly={locked}
            onChange={onInput(index)}
            onKeyDown={onKeyDown(index)}
            onPaste={onPaste(index)}
            onFocus={onFocus(index)}
          />
        ))}
      </div>
      <div className="gf-otp-result" aria-hidden="true">
        {/* The kit's outline circle with a faint body (prototype v60): the circle
            draws first, then the tick from its left end, or the cross stroke by stroke. */}
        <svg viewBox="0 0 84 84">
          <circle className="gf-otp-ring" cx="42" cy="42" r="40" />
          <path className="gf-otp-tick" d="M26 43l11 11 21-23" />
          <g className="gf-otp-cross">
            <path d="M31 31l22 22" />
            <path className="gf-otp-x2" d="M53 31 31 53" />
          </g>
        </svg>
      </div>
    </div>
  )
})
