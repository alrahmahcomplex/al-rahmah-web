import type { Permission } from "@/lib/permissions"

/**
 * Register students needs the fees too (owner, 2026-11-17): a role that can
 * register can read the Fee schedule, so the fee step always has its numbers.
 * Home shows the button, and the page opens, only with all three.
 */
export const REGISTER_PERMISSIONS = ["leads.create", "visits.record", "payments.view"] as const satisfies readonly Permission[]

export const mayRegister = (permissions: readonly string[]) => REGISTER_PERMISSIONS.every((p) => permissions.includes(p))
