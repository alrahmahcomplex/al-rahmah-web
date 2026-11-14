import type { CSSProperties, ReactNode, Ref } from "react"

import { Illustration } from "@/components/illustrations"
import { cn } from "@/lib/utils"

import "./kit.css"

/**
 * Nothing to show (DESIGN.md, States): a line illustration at 150px, a title
 * saying why, a line saying how to get something back, and at most one
 * action. It stands where the list would be, inside the same card. `search`
 * when nothing matches, `done` when nothing is due, `inbox` when no request
 * waits, `oops` for a failure shown with Try again.
 */
export function EmptyState({
  title,
  hint,
  action,
  illustration = "search",
  className,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  illustration?: "search" | "done" | "inbox" | "oops"
  className?: string
}) {
  return (
    <div className={cn("kit-empty", className)}>
      <Illustration name={illustration} size={150} />
      <b className="kit-empty-title">{title}</b>
      {hint && <p>{hint}</p>}
      {action && <div className="kit-empty-act">{action}</div>}
    </div>
  )
}

/**
 * Waiting inside a task ("Finding the family…"): a moving line illustration at
 * 170px over one line, announced politely. `finding` while a record loads,
 * `sending` for longer work such as a batch.
 */
export function LoadingState({ label, illustration = "finding", className }: { label: ReactNode; illustration?: "finding" | "sending"; className?: string }) {
  return (
    <div role="status" className={cn("kit-loading", className)}>
      <Illustration name={illustration} size={170} />
      <p>{label}</p>
    </div>
  )
}

/**
 * The finish mark (DESIGN.md, Finish): the live Admission form's 84px green
 * circle, which draws itself, then the tick, left to right. Give it to
 * `rainConfetti` and the confetti bursts from its centre once the tick ends.
 * Under reduced motion it is drawn at once. Decorative.
 */
export function FinishMark({ className, ref }: { className?: string; ref?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cn("kit-mark", className)} aria-hidden="true">
      <svg viewBox="0 0 84 84" width="84" height="84" focusable="false">
        <circle cx="42" cy="42" r="40" />
        <path className="kit-mark-tick" d="M26 43l11 11 21-23" />
      </svg>
    </span>
  )
}

export type FinishedResult = { label: ReactNode; value: ReactNode }

/**
 * A finished task, inside its TaskCard: the finish mark, a title saying what
 * happened, a hint saying what to do next, the results (each Admission Number
 * on a Lavender Whisper row), then `children`: notes and the next actions.
 */
export function FinishedState({
  title,
  hint,
  results,
  titleId,
  className,
  children,
}: {
  title: ReactNode
  hint?: ReactNode
  results?: FinishedResult[]
  /** The title takes focus (tabIndex -1) so the result is read out when the form gives way to it. */
  titleId?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn("kit-done", className)}>
      <FinishMark />
      <h2 id={titleId} tabIndex={-1} className="kit-done-title">
        {title}
      </h2>
      {hint && <p className="kit-done-hint">{hint}</p>}
      {results && results.length > 0 && (
        <ul className="kit-nums">
          {results.map((result, i) => (
            <li key={i}>
              <span>{result.label}</span>
              <b>{result.value}</b>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  )
}

/**
 * One still Lavender Whisper block for a page's loading.tsx, at the real
 * size and corner of what it stands for. It never pulses or shimmers. Wrap
 * the blocks in an element with role="status" that names what is loading.
 */
export function SkeletonBlock({
  width,
  height,
  shape = "line",
  className,
}: {
  width?: CSSProperties["width"]
  height: CSSProperties["height"]
  /** `line` 8px corners, `pill` for buttons and fields, `card` 24px corners. */
  shape?: "line" | "pill" | "card"
  className?: string
}) {
  return <span aria-hidden="true" className={cn("kit-bone", className)} data-shape={shape === "line" ? undefined : shape} style={{ width, height }} />
}
