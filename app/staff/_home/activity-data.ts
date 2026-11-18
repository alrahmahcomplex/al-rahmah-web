import type { SupabaseClient } from "@supabase/supabase-js"

import type { Permission } from "@/lib/permissions"
import type { SeatsByClass } from "@/lib/services/dashboard"
import { fullClasses, getHomeActivity, type FullClass } from "@/lib/services/home-activity"
import type { Result } from "@/lib/services/result"

import { activityView, type ActivityView } from "./activity"
import { mayOpenSeats } from "./quick-action-list"
import { namedFullClasses } from "./seats-named"

export type ActivityScreenPage = { rows: ActivityView[]; total: number; page: number; pageCount: number }

/**
 * The full classes the log names, only for staff who may open Seats: the row
 * is theirs alone, and its button opens that screen. Once streams are on
 * (#449), one row per class and need with no free seat.
 */
export function fullClassesFor(permissions: readonly Permission[], seats: SeatsByClass | null): FullClass[] {
  if (!mayOpenSeats(permissions) || !seats) return []
  return seats.named ? namedFullClasses(seats.named.streams) : fullClasses(seats.classes)
}

/**
 * Whether Home shows the log at all: every kind but the full classes needs
 * leads.view, and the full classes go to staff who may open Seats.
 */
export function mayReadActivity(permissions: readonly Permission[]): boolean {
  return permissions.includes("leads.view") || mayOpenSeats(permissions)
}

/** One page of the log, each row as this staff member sees it. */
export async function activityScreenPage(
  supabase: SupabaseClient,
  { page, permissions, today, full }: { page: number; permissions: readonly Permission[]; today: string; full: FullClass[] },
): Promise<Result<ActivityScreenPage, "forbidden" | "unavailable">> {
  const read = await getHomeActivity(supabase, page, full)
  if (!read.ok) return read
  const context = { today, permissions }
  return { ok: true, data: { ...read.data, rows: read.data.rows.map((row) => activityView(row, context)) } }
}
