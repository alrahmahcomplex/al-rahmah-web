"use server"

import { listPendingDiscountRequests } from "@/lib/services/discounts"
import { listPendingReopeningRequests } from "@/lib/services/reopening-requests"
import { createClient } from "@/utils/supabase/server"

import { canDecideDiscount } from "../applicants/[id]/discount-outcome"
import { canDecideReopening } from "../applicants/[id]/reopening-decision-outcome"
import { requireStaff } from "../session"
import { bellRequests, type BellRequest } from "./bell-requests"

/**
 * The bell's list, read when its popover opens: the Pending requests the
 * signed-in staff member may decide. A list they may not read is left out;
 * if one that they may read cannot be loaded, the bell says so.
 */
export async function loadBellRequests(): Promise<{ ok: true; data: BellRequest[] } | { ok: false }> {
  const staff = await requireStaff()
  const supabase = await createClient()
  const mayReopen = canDecideReopening(staff.permissions) && staff.permissions.includes("leads.view")
  const [discounts, reopenings] = await Promise.all([
    canDecideDiscount(staff.permissions) ? listPendingDiscountRequests(supabase) : null,
    mayReopen ? listPendingReopeningRequests(supabase) : null,
  ])
  if ((discounts && !discounts.ok) || (reopenings && !reopenings.ok)) return { ok: false }
  return { ok: true, data: bellRequests(discounts?.ok ? discounts.data : [], reopenings?.ok ? reopenings.data : []) }
}
