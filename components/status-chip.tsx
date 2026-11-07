import { cn } from "@/lib/utils"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

// One chip for a lead's status or closure mark, wherever staff see it
// (DESIGN.md, Status chips). Tints come from the brand scales; every pair
// keeps its text at 4.5:1 or more on its own background.
const TONES = {
  Applied: "bg-slate-100 text-slate-700",
  Visited: "bg-blue-50 text-blue-700",
  Interviewed: "bg-orange-50 text-orange-800",
  Enrolled: "bg-green-50 text-green-800",
  Declined: "bg-red-50 text-red-700",
  Inactive: "bg-white text-slate-600 ring-1 ring-slate-300 ring-inset",
  Archived: "bg-slate-200 text-slate-700",
} as const satisfies Record<LeadStatus | LeadClosure, string>

export function StatusChip({ status, className }: { status: LeadStatus | LeadClosure; className?: string }) {
  return (
    <span
      data-slot="status-chip"
      className={cn(
        "inline-flex h-[22px] w-fit shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
        TONES[status],
        className,
      )}
    >
      {status}
    </span>
  )
}
