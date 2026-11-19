import type { Permission } from "@/lib/permissions"
import type { ClassSeatFigures } from "@/lib/services/dashboard"

import type { QuickAction } from "./quick-actions"

// Home's three shortcuts (#323), in v38's order, each only for staff who can
// open its page. A caption shows only when it has something to say: a count
// above zero, or the one class that is full.

const has = (permissions: readonly Permission[], ...needed: Permission[]) => needed.every((permission) => permissions.includes(permission))

export const mayCallBack = (permissions: readonly Permission[]) => has(permissions, "leads.view")
// Seats are counted in streams (#449): everyone who may view payments opens
// Seats, as the sidebar shows it; only staff who manage academic years
// change streams there.
export const mayOpenSeats = (permissions: readonly Permission[]) => has(permissions, "payments.view")
export const mayDecideDiscounts = (permissions: readonly Permission[]) => has(permissions, "discounts.approve")

/**
 * The class to name as full, when exactly one is. A class with Day and
 * Boarding seats is named only when both are full, and seats not set are
 * never full, as the database counts them; when several classes are full,
 * none is named, since no words for that are approved yet.
 */
export function onlyFullClass(classes: readonly ClassSeatFigures[]): string | null {
  const isFull = (entry: ClassSeatFigures) => entry.seats !== null && entry.taken >= entry.seats
  const names = [...new Set(classes.map((entry) => entry.className))]
  const full = names.filter((name) => classes.filter((entry) => entry.className === name).every(isFull))
  return full.length === 1 ? full[0] : null
}

export function quickActions({
  permissions,
  overdue,
  fullClass,
  seatsCaption,
  waitingDiscounts,
}: {
  permissions: readonly Permission[]
  overdue: number | null
  fullClass: string | null
  // Once streams are on (#449): the Seats caption itself, v42’s "{class} needs a new stream".
  seatsCaption?: string | null
  waitingDiscounts: number | null
}): QuickAction[] {
  const actions: QuickAction[] = []
  if (mayCallBack(permissions))
    actions.push({ href: "/staff/follow-ups", icon: "followups", title: "Call a family back", caption: overdue ? `${overdue} overdue` : undefined })
  if (mayOpenSeats(permissions)) actions.push({ href: "/staff/seats", icon: "seats", title: "Seats", caption: seatsCaption ?? (fullClass ? `${fullClass} is full` : undefined) })
  if (mayDecideDiscounts(permissions))
    actions.push({
      href: "/staff/discounts",
      icon: "discounts",
      title: "Request a discount",
      caption: waitingDiscounts ? `${waitingDiscounts} waiting for a decision` : undefined,
    })
  return actions
}
