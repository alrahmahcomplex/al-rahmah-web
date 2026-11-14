"use client"

import { useId, useState, type ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./picked.css"

export type AccordionItem = { title: ReactNode; content: ReactNode }

/**
 * Accordion A, separate cards (prototype v38): questions and longer details
 * most people skip. Each is its own card with a chevron; one opens at a time,
 * and pressing the open one closes it. The answer folds open in 300ms (at
 * once under reduced motion); a closed answer is out of the tab order. Each
 * question is a heading of `headingLevel`, holding its button.
 */
export function Accordion({ items, defaultOpen = 0, headingLevel = 3, className }: { items: AccordionItem[]; defaultOpen?: number | null; headingLevel?: 2 | 3 | 4; className?: string }) {
  const [open, setOpen] = useState<number | null>(defaultOpen)
  const base = useId()
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4"
  return (
    <div className={cn("kit-acc", className)}>
      {items.map((item, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="kit-acc-item" data-open={isOpen ? "" : undefined}>
            <Heading>
              <button type="button" id={`${base}-q${i}`} className="kit-acc-btn" aria-expanded={isOpen} aria-controls={`${base}-a${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                <span>{item.title}</span>
                <Icon name="down" size={16} />
              </button>
            </Heading>
            <div id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`} className="kit-acc-panel">
              <div inert={!isOpen}>
                <div className="kit-acc-body">{item.content}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
