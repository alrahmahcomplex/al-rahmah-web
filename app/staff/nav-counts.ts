import "server-only"

import { countPendingDiscountRequests, listPendingDiscountRequests } from "@/lib/services/discounts"
import { countPendingReopeningRequests } from "@/lib/services/reopening-requests"
import { listPendingSiblingRequests } from "@/lib/services/sibling-requests"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// What waits on the request screens the bell covers (app/staff/bell-screens.ts),
// by href, for staff who may view leads. A count that can't be read is left
// out rather than holding up every staff page.
export async function requestCounts(staff: Pick<StaffMember, "permissions">): Promise<Partial<Record<string, number>>> {
  const counts: Partial<Record<string, number>> = {}
  if (!staff.permissions.includes("leads.view")) return counts
  const supabase = await createClient()
  const [discounts, siblings, reopenings] = await Promise.all([
    staff.permissions.includes("discounts.approve") ? countPendingDiscountRequests(supabase) : null,
    // Sibling requests wait on the same screen (#310).
    staff.permissions.includes("discounts.approve") ? listPendingSiblingRequests(supabase) : null,
    staff.permissions.includes("reopenings.approve") ? countPendingReopeningRequests(supabase) : null,
  ])
  if (discounts?.ok) counts["/staff/discounts"] = discounts.data + (siblings?.ok ? siblings.data.length : 0)
  if (reopenings?.ok) counts["/staff/reopenings"] = reopenings.data
  return counts
}

// The bell's number (#322): the Pending requests on the request screens this
// staff member may open (app/staff/bell-screens.ts). requestCounts covers
// them for staff who may view leads; a role that may approve
// discounts without viewing leads has its discount requests counted through
// the queue it would open, which needs only discounts.approve.
export async function bellPending(
  staff: Pick<StaffMember, "permissions">,
  screens: readonly string[],
  counts: Partial<Record<string, number>>,
): Promise<number> {
  let pending = 0
  for (const href of screens) {
    const known = counts[href]
    if (known !== undefined) pending += known
    else if (href === "/staff/discounts" && staff.permissions.includes("discounts.approve")) {
      const supabase = await createClient()
      const [queue, siblings] = await Promise.all([listPendingDiscountRequests(supabase), listPendingSiblingRequests(supabase)])
      if (queue.ok) pending += queue.data.length
      if (siblings.ok) pending += siblings.data.length
    }
  }
  return pending
}
