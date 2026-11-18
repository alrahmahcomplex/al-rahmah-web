"use server"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { activityScreenPage, fullClassesFor, type ActivityScreenPage } from "./activity-data"
import { mayOpenSeats } from "./quick-action-list"
import { seatsOnOpening } from "./seats-on-opening"

export type ActivityPageOutcome = { status: "ok"; page: ActivityScreenPage } | { status: "refused"; message: string }

const UNAVAILABLE = "The Activity log could not be loaded. Try again in a moment."

/** Another page of Home's Activity log, read again as the signed-in staff member. */
export async function loadActivityPage(page: number): Promise<ActivityPageOutcome> {
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return { status: "refused", message: UNAVAILABLE }
  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok) return { status: "refused", message: "Your session has ended. Sign in again, then try again." }
  const today = tanzaniaToday()
  const permissions = staff.data.permissions
  const seats = mayOpenSeats(permissions) ? await seatsOnOpening(supabase, today) : null
  const read = await activityScreenPage(supabase, {
    page,
    permissions,
    today,
    full: fullClassesFor(permissions, seats?.ok ? seats.data : null),
  })
  return read.ok ? { status: "ok", page: read.data } : { status: "refused", message: UNAVAILABLE }
}
