import type { ReactNode } from "react"

// Every panel on the lead page sits in one of these cards, two to a row on
// wide screens. A panel with nothing to show renders nothing, and its empty
// card is hidden.
export const LEAD_CARD = "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 empty:hidden sm:p-5"

// A card's heading, with its one action, such as Edit, on the right.
export function CardHeading({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <h2 id={id} className="staff-section-heading">
        {title}
      </h2>
      {action}
    </div>
  )
}
