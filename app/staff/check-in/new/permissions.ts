import type { Permission } from "@/lib/permissions"

/**
 * Who may register students (owner, 2026-11-17): whoever registers must be
 * able to finish the form. payments.view reads the Fee schedule for the fee
 * step; leads.edit links siblings and puts on the Discount code. Home shows
 * the button, and the page opens and saves, only with all four.
 */
export const REGISTER_PERMISSIONS = ["leads.create", "visits.record", "payments.view", "leads.edit"] as const satisfies readonly Permission[]

export const mayRegister = (permissions: readonly string[]) => REGISTER_PERMISSIONS.every((p) => permissions.includes(p))
