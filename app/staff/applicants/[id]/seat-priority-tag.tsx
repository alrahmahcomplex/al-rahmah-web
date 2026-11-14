import { Tag } from "@/components/kit"
import type { SeatPriority } from "@/lib/services/school-fee-payments"

// A lead's Seat priority on the lead record: a Line tag, as every tag on a lead
// that is not its lifecycle (DESIGN.md, Chips).
export function SeatPriorityTag({ priority }: { priority: SeatPriority }) {
  return <Tag tone="line">{priority}</Tag>
}
