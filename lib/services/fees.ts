import type { SupabaseClient } from "@supabase/supabase-js"

import { LEAD_CLASSES, type DayOrBoarding, type LeadClass } from "./leads"
import type { Result } from "./result"

// The fees module: every read and write of the Fee schedule goes through
// here. Writes are database functions that check the permission themselves;
// this file turns their answers into a Result.

export const FEE_BANDS = ["nursery", "primary_lower", "primary_upper", "secondary"] as const
export type FeeBand = (typeof FEE_BANDS)[number]

// The classes in each band. The database's fee_band_of holds the same
// mapping; tests/integration/fees.test.ts fails if the two drift apart.
export const BAND_CLASSES: Record<FeeBand, readonly LeadClass[]> = {
  nursery: ["DAY CARE", "KG 1", "KG 2"],
  primary_lower: ["STD 1", "STD 2", "STD 3", "STD 4"],
  primary_upper: ["STD 5", "STD 6", "STD 7"],
  secondary: ["FORM 1", "FORM 2", "FORM 3", "FORM 4"],
}

export const BAND_NAMES: Record<FeeBand, string> = {
  nursery: "Nursery",
  primary_lower: "Primary STD 1 to STD 4",
  primary_upper: "Primary STD 5 to STD 7",
  secondary: "Secondary",
}

export type DayAndBoarding = { day: number; boarding: number }

// What the Accountant maintains in a year's schedule. Amounts are whole TZS;
// the split is three whole percentages adding up to 100.
export type FeeAmounts = {
  bands: Record<FeeBand, DayAndBoarding>
  split: { first: number; second: number; third: number }
  dueDates: { first: string; second: string; third: string }
  minimumDeposit: number
  preFormOne: DayAndBoarding
}

// The seats the Admissions Manager has set for one class, day or boarding.
export type SeatSetting = { className: LeadClass; dayOrBoarding: DayOrBoarding; seats: number }

export type FeeSchedule = FeeAmounts & {
  year: number
  // Set by the Admissions Manager; empty until then.
  academicYearStart: string | null
  // Only the classes whose seats are set, in class order, Day before
  // Boarding. A class missing here has its seats not set.
  seats: SeatSetting[]
}

// What the Admissions Manager sets on a year's schedule. Null leaves a start
// or a class that isn't set as it is; classes left out keep what they have.
export type AcademicYearSettings = {
  start: string | null
  seats: { className: LeadClass; dayOrBoarding: DayOrBoarding; seats: number | null }[]
}

// The value a refusal is about.
export type FeeField =
  | "enrollment_year"
  | "amounts"
  | `${FeeBand}.day_fee`
  | `${FeeBand}.boarding_fee`
  | "first_share"
  | "second_share"
  | "third_share"
  | "split"
  | "first_due"
  | "second_due"
  | "third_due"
  | "minimum_deposit"
  | "pre_form_one_day_fee"
  | "pre_form_one_boarding_fee"

export type AcademicYearField = "academic_year_start" | "seats" | `seats.${LeadClass}.${DayOrBoarding}`

export type SetAcademicYearError =
  | { kind: "forbidden" }
  | { kind: "no-schedule" }
  | { kind: "invalid"; field: AcademicYearField | null }
  | { kind: "unavailable" }

export type SaveFeeAmountsError =
  | { kind: "forbidden" }
  | { kind: "invalid"; field: FeeField | null }
  | { kind: "unavailable" }

type ScheduleRow = {
  enrollment_year: number
  first_share: number
  second_share: number
  third_share: number
  first_due: string
  second_due: string
  third_due: string
  minimum_deposit: number
  pre_form_one_day_fee: number
  pre_form_one_boarding_fee: number
  academic_year_start: string | null
  fee_band_amounts: { band: FeeBand; day_fee: number; boarding_fee: number }[]
  class_seats: { class_name: LeadClass; day_or_boarding: DayOrBoarding; seats: number }[]
}

const SCHEDULE_COLUMNS =
  "enrollment_year, first_share, second_share, third_share, first_due, second_due, third_due, minimum_deposit, pre_form_one_day_fee, pre_form_one_boarding_fee, academic_year_start, fee_band_amounts (band, day_fee, boarding_fee), class_seats (class_name, day_or_boarding, seats)"

const seatOrder = (seat: SeatSetting) => LEAD_CLASSES.indexOf(seat.className) * 2 + (seat.dayOrBoarding === "Day" ? 0 : 1)

function toSchedule(row: ScheduleRow): FeeSchedule {
  const bands = Object.fromEntries(
    row.fee_band_amounts.map((amount) => [amount.band, { day: amount.day_fee, boarding: amount.boarding_fee }]),
  ) as Record<FeeBand, DayAndBoarding>
  return {
    year: row.enrollment_year,
    bands,
    split: { first: row.first_share, second: row.second_share, third: row.third_share },
    dueDates: { first: row.first_due, second: row.second_due, third: row.third_due },
    minimumDeposit: row.minimum_deposit,
    preFormOne: { day: row.pre_form_one_day_fee, boarding: row.pre_form_one_boarding_fee },
    academicYearStart: row.academic_year_start,
    seats: row.class_seats
      .map((seat) => ({ className: seat.class_name, dayOrBoarding: seat.day_or_boarding, seats: seat.seats }))
      .sort((a, b) => seatOrder(a) - seatOrder(b)),
  }
}

// Every year's schedule, newest year first, for staff who may view payments.
// Row-level security returns nothing to anyone else.
export async function listFeeSchedules(supabase: SupabaseClient): Promise<Result<FeeSchedule[], "unavailable">> {
  const { data, error } = await supabase
    .from("fee_schedules")
    .select(SCHEDULE_COLUMNS)
    .order("enrollment_year", { ascending: false })
  if (error) {
    console.error("Could not list the fee schedules", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: (data as unknown as ScheduleRow[]).map(toSchedule) }
}

// One year's schedule. A year with none, or a reader without payments.view,
// reads as not found.
export async function getFeeSchedule(
  supabase: SupabaseClient,
  year: number,
): Promise<Result<FeeSchedule, "not-found" | "unavailable">> {
  if (!Number.isInteger(year)) return { ok: false, error: "not-found" }
  const { data, error } = await supabase
    .from("fee_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("enrollment_year", year)
    .maybeSingle<ScheduleRow>()
  if (error) {
    console.error("Could not read a fee schedule", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-found" }
  return { ok: true, data: toSchedule(data) }
}

const FEE_FIELDS = new Set<string>([
  "enrollment_year",
  "amounts",
  "first_share",
  "second_share",
  "third_share",
  "split",
  "first_due",
  "second_due",
  "third_due",
  "minimum_deposit",
  "pre_form_one_day_fee",
  "pre_form_one_boarding_fee",
  ...FEE_BANDS.flatMap((band) => [`${band}.day_fee`, `${band}.boarding_fee`]),
])

// The field a refusal names, if `known` holds it.
function refusedField<F extends string>(details: string | null | undefined, known: Set<string>): F | null {
  try {
    const field = JSON.parse(details ?? "")?.field
    return typeof field === "string" && known.has(field) ? (field as F) : null
  } catch {
    return null
  }
}

// Creates the year's schedule, or replaces its amounts, split and due dates.
// Needs payments.record. Every value is required: a missing, zero or negative
// amount, or a split that doesn't add up to 100, is refused as `invalid` with
// the field, and nothing is saved.
export async function saveFeeAmounts(
  supabase: SupabaseClient,
  year: number,
  amounts: FeeAmounts,
): Promise<Result<null, SaveFeeAmountsError>> {
  const bands = Object.fromEntries(
    FEE_BANDS.map((band) => [band, { day_fee: amounts.bands?.[band]?.day, boarding_fee: amounts.bands?.[band]?.boarding }]),
  )
  const { error } = await supabase.rpc("save_fee_schedule", {
    schedule_year: year,
    amounts: {
      bands,
      first_share: amounts.split?.first,
      second_share: amounts.split?.second,
      third_share: amounts.split?.third,
      first_due: amounts.dueDates?.first,
      second_due: amounts.dueDates?.second,
      third_due: amounts.dueDates?.third,
      minimum_deposit: amounts.minimumDeposit,
      pre_form_one_day_fee: amounts.preFormOne?.day,
      pre_form_one_boarding_fee: amounts.preFormOne?.boarding,
    },
  })
  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: { kind: "forbidden" } }
    if (error.message === "invalid") return { ok: false, error: { kind: "invalid", field: refusedField<FeeField>(error.details, FEE_FIELDS) } }
    console.error("Could not save a fee schedule", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return { ok: true, data: null }
}

const ACADEMIC_YEAR_FIELDS = new Set<string>([
  "academic_year_start",
  "seats",
  ...LEAD_CLASSES.flatMap((className) => [`seats.${className}.Day`, `seats.${className}.Boarding`]),
])

// JSON has no NaN or Infinity and would send them as null, which reads as
// "leave it as it is". Sent as text, the database refuses them by name.
const asSent = (seats: number | null) => (seats === null || Number.isFinite(seats) ? seats : String(seats))

// Sets the year's Academic-year start, a date in January of that year, and
// the seats in each class, for day and for boarding. Needs
// academic_years.manage, and a Fee schedule for the year, which the
// Accountant creates. A start or a seat count, once set, can be changed but
// not cleared. When anything is refused, nothing is saved.
export async function setAcademicYear(
  supabase: SupabaseClient,
  year: number,
  settings: AcademicYearSettings,
): Promise<Result<null, SetAcademicYearError>> {
  const { error } = await supabase.rpc("set_academic_year", {
    schedule_year: year,
    settings: {
      academic_year_start: settings.start,
      seats: settings.seats.map((seat) => ({
        class_name: seat.className,
        day_or_boarding: seat.dayOrBoarding,
        seats: asSent(seat.seats),
      })),
    },
  })
  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: { kind: "forbidden" } }
    if (error.message === "no_schedule") return { ok: false, error: { kind: "no-schedule" } }
    if (error.message === "invalid") {
      return {
        ok: false,
        error: { kind: "invalid", field: refusedField<AcademicYearField>(error.details, ACADEMIC_YEAR_FIELDS) },
      }
    }
    console.error("Could not set the academic year", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return { ok: true, data: null }
}
