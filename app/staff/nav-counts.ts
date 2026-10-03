import "server-only"

import { getPendingAgentCount } from "@/lib/services/marketing-agents"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// The counts the staff navigation shows beside an entry, by href: work
// waiting for this staff member. A count that can't be read is left out
// rather than holding up every staff page.
export async function navCounts(staff: Pick<StaffMember, "permissions">): Promise<Partial<Record<string, number>>> {
  const counts: Partial<Record<string, number>> = {}
  if (staff.permissions.includes("agents.approve") && staff.permissions.includes("leads.view")) {
    const pending = await getPendingAgentCount(await createClient())
    if (pending.ok) counts["/staff/agents"] = pending.data
  }
  return counts
}
