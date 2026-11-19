import type { Permission } from "@/lib/permissions"

import type { QuickAction } from "./quick-actions"

// Home's three shortcuts (#323), in v38's order, each only for staff who can
// open its page. A caption shows only when it has something to say: a count
// above zero, or the class that needs a new stream.

const has = (permissions: readonly Permission[], ...needed: Permission[]) => needed.every((permission) => permissions.includes(permission))

export const mayCallBack = (permissions: readonly Permission[]) => has(permissions, "leads.view")
// Seats are counted in streams (#449): everyone who may view payments opens
// Seats, as the sidebar shows it; only staff who manage academic years
// change streams there.
export const mayOpenSeats = (permissions: readonly Permission[]) => has(permissions, "payments.view")
export const mayDecideDiscounts = (permissions: readonly Permission[]) => has(permissions, "discounts.approve")

export function quickActions({
  permissions,
  overdue,
  seatsCaption,
  waitingDiscounts,
}: {
  permissions: readonly Permission[]
  overdue: number | null
  // The Seats caption itself, v42’s "{class} needs a new stream" (#449).
  seatsCaption: string | null
  waitingDiscounts: number | null
}): QuickAction[] {
  const actions: QuickAction[] = []
  if (mayCallBack(permissions))
    actions.push({ href: "/staff/follow-ups", icon: "followups", title: "Call a family back", caption: overdue ? `${overdue} overdue` : undefined })
  if (mayOpenSeats(permissions)) actions.push({ href: "/staff/seats", icon: "seats", title: "Seats", caption: seatsCaption ?? undefined })
  if (mayDecideDiscounts(permissions))
    actions.push({
      href: "/staff/discounts",
      icon: "discounts",
      title: "Request a discount",
      caption: waitingDiscounts ? `${waitingDiscounts} waiting for a decision` : undefined,
    })
  return actions
}
