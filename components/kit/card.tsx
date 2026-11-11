"use client"

import { useId, type HTMLAttributes, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** The card's heading, an h2 in the Card title style. Names the section for a screen reader. */
  title?: ReactNode
  /** A Slate Quiet line under the title. */
  caption?: ReactNode
  /** The heading's id; one is made when left out. A card with a title is a region named by it. */
  titleId?: string
}

/** A resting white card: 24px corners, the 1.5px Indigo Line, the Card shadow. */
export function Card({ title, caption, titleId, className, children, ...props }: CardProps) {
  const madeId = useId()
  const headingId = titleId ?? madeId
  return (
    <section aria-labelledby={title ? headingId : undefined} className={cn("kit-card", className)} {...props}>
      {title && (
        <h2 id={headingId} className="kit-card-title">
          {title}
        </h2>
      )}
      {caption && <p className="kit-card-cap">{caption}</p>}
      {children}
    </section>
  )
}

/** The one card on a page that holds the task: 40px corners, no outline, the Indigo lift (The One Lift Rule). */
export function TaskCard({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("kit-task", className)} {...props}>
      {children}
    </section>
  )
}
