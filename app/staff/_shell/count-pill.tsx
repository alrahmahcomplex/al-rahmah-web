import { cn } from "@/lib/utils"

import type { NavCount } from "../nav-counts"

// How many items wait at an entry, in orange, the colour of something to act
// on, with what they are for screen readers: "Follow-ups, 8 overdue".
export function CountPill({ count, className }: { count: NavCount; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-orange-50 font-semibold text-orange-700 tabular-nums",
        className,
      )}
    >
      <span className="sr-only">, </span>
      {count.count}
      <span className="sr-only"> {count.label}</span>
    </span>
  )
}
