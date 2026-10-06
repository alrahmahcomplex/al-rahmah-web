import "server-only"

import { getOverdueCount } from "@/lib/services/follow-ups"
import { getPendingAgentCount } from "@/lib/services/marketing-agents"
import { countUnreviewedReApplications } from "@/lib/services/re-applications"
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
  const [pending, unreviewed, overdue] = await Promise.all([
    staff.permissions.includes("agents.approve") ? getPendingAgentCount(supabase) : null,
    countUnreviewedReApplications(supabase),
    getOverdueCount(supabase),
  ])
  if (pending?.ok) counts["/staff/agents"] = { count: pending.data, label: "Pending" }
  if (unreviewed.ok) counts["/staff/re-applications"] = { count: unreviewed.data, label: "unreviewed" }
  if (overdue.ok) counts["/staff/follow-ups"] = { count: overdue.data, label: "overdue" }
  return counts
}
