import type { ReactNode } from "react"

import "@/components/kit/kit.css"

import "./lead.css"

// Every panel on the lead page sits in one of these kit cards, two to a row on
// wide screens. A panel with nothing to show renders nothing, and its empty
// card is hidden.
export const LEAD_CARD = "kit-card lr-card"

// A card's heading, with its one action, such as Edit, on the right.
export function CardHeading({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="lr-card-head">
      <h2 id={id} className="kit-card-title">
        {title}
      </h2>
      {action}
    </div>
  )
}
