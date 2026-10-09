import "server-only"

import { countPendingDiscountRequests } from "@/lib/services/discounts"
import { getOverdueCount } from "@/lib/services/follow-ups"
import { getPendingAgentCount } from "@/lib/services/marketing-agents"
import { countUnreviewedReApplications } from "@/lib/services/re-applications"
import { countPendingReopeningRequests } from "@/lib/services/reopening-requests"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// What a count beside a navigation entry counts, for screen readers: "3
// Pending", "2 unreviewed", "4 overdue".
export type NavCount = { count: number; label: string }

// The counts the staff navigation shows beside an entry, by href: work
// waiting for this staff member. A count that can't be read is left out
// rather than holding up every staff page.
export async function navCounts(staff: Pick<StaffMember, "permissions">): Promise<Partial<Record<string, NavCount>>> {
  const counts: Partial<Record<string, NavCount>> = {}
  if (!staff.permissions.includes("leads.view")) return counts
  const supabase = await createClient()
  const [pending, unreviewed, overdue, discounts, reopenings] = await Promise.all([
    staff.permissions.includes("agents.approve") ? getPendingAgentCount(supabase) : null,
    countUnreviewedReApplications(supabase),
    getOverdueCount(supabase),
    staff.permissions.includes("discounts.approve") ? countPendingDiscountRequests(supabase) : null,
    staff.permissions.includes("reopenings.approve") ? countPendingReopeningRequests(supabase) : null,
  ])
  if (pending?.ok) counts["/staff/agents"] = { count: pending.data, label: "Pending" }
  if (unreviewed.ok) counts["/staff/re-applications"] = { count: unreviewed.data, label: "unreviewed" }
  if (overdue.ok) counts["/staff/follow-ups"] = { count: overdue.data, label: "overdue" }
  if (discounts?.ok) counts["/staff/discounts"] = { count: discounts.data, label: "Pending" }
  if (reopenings?.ok) counts["/staff/reopenings"] = { count: reopenings.data, label: "Pending" }
  return counts
}
