import type { Permission } from "@/lib/permissions"

// Who opens the Fee schedule screen: staff who may view payments, and those
// who manage academic years.
export function canReadFeeSchedule(permissions: readonly Permission[]): boolean {
  return permissions.includes("payments.view") || permissions.includes("academic_years.manage")
}

// A year as typed in a URL or the New schedule form, or null when it isn't
// one a schedule may have.
export function parseScheduleYear(typed: string): number | null {
  const trimmed = typed.trim()
  if (!/^\d{4}$/.test(trimmed)) return null
  const year = Number(trimmed)
  return year >= 2000 && year <= 2999 ? year : null
}

// The amounts sit behind payments.view in the database, so staff who only
// manage academic years open the screen but don't see them.
export function canSeeFeeAmounts(permissions: readonly Permission[]): boolean {
  return permissions.includes("payments.view")
}

// What staff who open the screen without payments.view are told instead.
export const NOT_SHOWN_WITHOUT_PAYMENTS_VIEW =
  "The Fee schedule, with its amounts, Academic-year start and seats, is shown only to staff who can view payments."

// Editing needs the amounts in view too: a save replaces the whole year, so
// staff who can't read it would overwrite a schedule they never saw.
export function canEditFeeAmounts(permissions: readonly Permission[]): boolean {
  return canSeeFeeAmounts(permissions) && permissions.includes("payments.record")
}

// The Academic-year start and seats sit behind payments.view in the database
// too, so setting them from the screen needs it as well as
// academic_years.manage: nobody changes values they can't read.
export function canEditAcademicYear(permissions: readonly Permission[]): boolean {
  return canSeeFeeAmounts(permissions) && permissions.includes("academic_years.manage")
}
