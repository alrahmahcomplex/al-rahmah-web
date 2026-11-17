import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type BentoProps = HTMLAttributes<HTMLDivElement> & {
  /** The most columns the grid takes when it is wide enough: 3 from 880px of its own width, 2 from 580px. */
  columns?: 2 | 3
}

/**
 * Cards side by side in the bento rule (prototype v40, Design system): each
 * card in a row is as tall as the tallest, and a short last row fills the
 * width. Give a card `data-bento="full"` to span the row; put full cards
 * first or last, or start a new Bento after one. Props go on the grid.
 */
export function Bento({ columns = 3, className, children, ...props }: BentoProps) {
  return (
    <div className="kit-bento-w">
      <div data-columns={columns} className={cn("kit-bento", className)} {...props}>
        {children}
      </div>
    </div>
  )
}
