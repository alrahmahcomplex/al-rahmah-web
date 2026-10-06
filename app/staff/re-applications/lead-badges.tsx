import { Badge } from "@/components/ui/badge"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

// The lead's status and closure mark, as the Leads list shows them.
export function LeadBadges({ status, closure }: { status: LeadStatus; closure: LeadClosure | null }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={status === "Declined" ? "destructive" : "secondary"}>{status}</Badge>
      {closure && <Badge variant="outline">{closure}</Badge>}
    </span>
  )
}
