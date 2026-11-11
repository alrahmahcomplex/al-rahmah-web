import type { CSSProperties, ReactNode } from "react"

import { Illustration } from "@/components/illustrations"
import { cn } from "@/lib/utils"

import "./kit.css"

/**
 * Nothing to show (DESIGN.md, States): the Empty illustration at 130px, a
 * title saying why, a line saying how to get something back, and at most one
 * action. It stands where the list would be, inside the same card.
 */
export function EmptyState({ title, hint, action, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("kit-empty", className)}>
      <Illustration name="empty" size={130} />
      <b className="kit-empty-title">{title}</b>
      {hint && <p>{hint}</p>}
      {action && <div className="kit-empty-act">{action}</div>}
    </div>
  )
}

/** Waiting inside a task ("Finding the family…"): the Loading illustration at 150px over one line, announced politely. */
export function LoadingState({ label, className }: { label: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("kit-loading", className)}>
      <Illustration name="loading" size={150} />
      <p>{label}</p>
    </div>
  )
}

export type FinishedResult = { label: ReactNode; value: ReactNode }

/**
 * A finished task, inside its TaskCard: the Finished illustration at 150px, a
 * title saying what happened, a hint saying what to do next, the results
 * (each Admission Number on a Lavender Whisper row), then `children`: notes
 * and the next actions.
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
      <Illustration name="finished" size={150} />
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
