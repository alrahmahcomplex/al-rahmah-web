"use server"

import { revalidatePath } from "next/cache"

import {
  FEE_BANDS,
  saveFeeAmounts,
  setAcademicYear,
  type AcademicYearSeen,
  type AcademicYearSettings,
  type FeeAmounts,
} from "@/lib/services/fees"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  academicYearOutcome,
  saveScheduleOutcome,
  type AcademicYearOutcome,
  type SaveScheduleOutcome,
} from "./outcome"

const REFUSED_INPUT: SaveScheduleOutcome = {
  status: "refused",
  field: null,
  message: "Some amounts could not be read. Reload the page and try again.",
}

// A blank amount arrives as NaN, which the database refuses as missing.
const isNumber = (value: unknown) => typeof value === "number"
const isString = (value: unknown) => typeof value === "string"
const isPair = (value: unknown, check: (v: unknown) => boolean) =>
  typeof value === "object" && value !== null && Object.values(value).every(check)

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks every amount and the permission.
export async function saveSchedule(year: number, amounts: FeeAmounts): Promise<SaveScheduleOutcome> {
  if (
    !Number.isInteger(year) ||
    typeof amounts !== "object" ||
    amounts === null ||
    !FEE_BANDS.every((band) => isPair(amounts.bands?.[band], isNumber)) ||
    !isPair(amounts.split, isNumber) ||
    !isPair(amounts.dueDates, isString) ||
    !isNumber(amounts.minimumDeposit) ||
    !isPair(amounts.preFormOne, isNumber)
  ) {
    return REFUSED_INPUT
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "payments.record")
  if (!allowed.ok) return saveScheduleOutcome({ kind: "forbidden" })

  const result = await saveFeeAmounts(supabase, year, {
    bands: Object.fromEntries(
      FEE_BANDS.map((band) => [band, { day: amounts.bands[band].day, boarding: amounts.bands[band].boarding }]),
    ) as FeeAmounts["bands"],
    split: { first: amounts.split.first, second: amounts.split.second, third: amounts.split.third },
    dueDates: { first: amounts.dueDates.first, second: amounts.dueDates.second, third: amounts.dueDates.third },
    minimumDeposit: amounts.minimumDeposit,
    preFormOne: { day: amounts.preFormOne.day, boarding: amounts.preFormOne.boarding },
  })
  if (!result.ok) return saveScheduleOutcome(result.error)
  revalidatePath("/staff/fees", "layout")
  return { status: "saved" }
}

const REFUSED_SETTINGS: AcademicYearOutcome = {
  status: "refused",
  field: null,
  message: "The start could not be read. Reload the page and try again.",
}

const isSettings = (value: unknown): value is AcademicYearSettings =>
  typeof value === "object" &&
  value !== null &&
  ((value as AcademicYearSettings).start === null || isString((value as AcademicYearSettings).start))

// Sets the year's Academic-year start, against what the form saw when it
// opened, so a stale form can't undo a newer change. The shape is checked
// here; the database checks the permission and the date. Seats are never
// sent: they live in streams (#449).
export async function saveAcademicYear(
  year: number,
  settings: AcademicYearSettings,
  seen: AcademicYearSeen,
): Promise<AcademicYearOutcome> {
  if (!Number.isInteger(year) || !isSettings(settings) || !isSettings(seen)) {
    return REFUSED_SETTINGS
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "academic_years.manage")
  if (!allowed.ok) return academicYearOutcome({ kind: "forbidden" }, year)

  const result = await setAcademicYear(supabase, year, { start: settings.start }, { start: seen.start })
  if (!result.ok) return academicYearOutcome(result.error, year)
  revalidatePath("/staff/fees", "layout")
  return { status: "saved" }
}
