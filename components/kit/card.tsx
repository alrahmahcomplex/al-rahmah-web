"use client"

import { useId, useRef, type HTMLAttributes, type ReactNode, type Ref } from "react"

import { cn } from "@/lib/utils"

import { ScrollBar } from "./scroll-bar"
import "./kit.css"

export type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** The card's heading, an h2 in the Card title style. Names the section for a screen reader. */
  title?: ReactNode
  /** A Slate Quiet line under the title. */
  caption?: ReactNode
  /** The heading's id; one is made when left out. A card with a title is a region named by it. */
  titleId?: string
  /**
   * Takes the height it is given and scrolls its content inside, above
   * `foot`, with the app's scrollbar just outside its right edge. For a
   * card that fills the stage (`data-stage-fill` in the shell). A filling
   * card comes in a wrapper that holds the bar; lay out the wrapper.
   */
  fill?: boolean
  /** The bottom edge of a filling card, such as a `SaveBar`. */
  foot?: ReactNode
}

/** A resting white card: 24px corners, the thin Indigo Line, the Card shadow. */
export function Card({ title, caption, titleId, fill, foot, className, children, ...props }: CardProps) {
  const madeId = useId()
  const headingId = titleId ?? madeId
  const bodyRef = useRef<HTMLDivElement>(null)
  const content = (
    <>
      {title && (
        <h2 id={headingId} className="kit-card-title">
          {title}
        </h2>
      )}
      {caption && <p className="kit-card-cap">{caption}</p>}
      {children}
    </>
  )
  if (!fill) {
    return (
      <section aria-labelledby={title ? headingId : undefined} className={cn("kit-card", className)} {...props}>
        {content}
      </section>
    )
  }
  return (
    <div className="kit-card-wrap">
      <section aria-labelledby={title ? headingId : undefined} className={cn("kit-card", className)} data-fill {...props}>
        <div ref={bodyRef} className="kit-card-body">
          {content}
        </div>
        {foot}
      </section>
      <ScrollBar target={bodyRef} />
    </div>
  )
}

/** The one card on a page that holds the task: 40px corners, no outline, the Indigo lift (The One Lift Rule). */
export function TaskCard({ className, children, ref, ...props }: HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }) {
  return (
    <section ref={ref} className={cn("kit-task", className)} {...props}>
      {children}
    </section>
  )
}
