import type { Permission } from "@/lib/permissions"

/**
 * Who may check in an Admission form family (#309): complete_admission_visit
 * needs visits.record and leads.edit; the family is read under leads.view and
 * the fee step reads the Fee schedule under payments.view. Home, the Activity
 * log and the Applicants sheet open check-in only with all four; anyone else
 * opens the student's record, as before.
 */
export const CHECK_IN_PERMISSIONS = ["visits.record", "leads.edit", "leads.view", "payments.view"] as const satisfies readonly Permission[]

export const mayCheckIn = (permissions: readonly string[]) => CHECK_IN_PERMISSIONS.every((p) => permissions.includes(p))

export const checkInHref = (leadId: string) => `/staff/check-in/${leadId}`
