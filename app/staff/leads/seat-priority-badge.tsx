import { Badge } from "@/components/ui/badge"
import type { SeatPriority } from "@/lib/services/school-fee-payments"

// A lead's Seat priority, on the lead screen and the lead list. Strongest
// first: Full is filled, First instalment tinted, Deposit outlined.
const VARIANTS = {
  Full: "default",
  "First instalment": "secondary",
  Deposit: "outline",
} as const satisfies Record<SeatPriority, "default" | "secondary" | "outline">

export function SeatPriorityBadge({ priority }: { priority: SeatPriority }) {
  return <Badge variant={VARIANTS[priority]}>{priority}</Badge>
}
