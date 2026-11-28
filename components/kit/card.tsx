"use client"

import { useId, type HTMLAttributes, type ReactNode, type Ref } from "react"

import { cn } from "@/lib/utils"

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
   * `foot`. For a card that fills the stage (`data-stage-fill` in the shell).
   */
  fill?: boolean
  /** The bottom edge of a filling card, such as a `SaveBar`. */
  foot?: ReactNode
}

/** A resting white card: 24px corners, the thin Indigo Line, the Card shadow. */
export function Card({ title, caption, titleId, fill, foot, className, children, ...props }: CardProps) {
  const madeId = useId()
  const headingId = titleId ?? madeId
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
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn("kit-card", className)}
      data-fill={fill || undefined}
      {...props}
    >
      {fill ? (
        <>
          <div className="kit-card-body">{content}</div>
          {foot}
        </>
      ) : (
        content
      )}
    </section>
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
