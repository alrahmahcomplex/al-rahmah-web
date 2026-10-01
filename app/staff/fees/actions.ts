"use server"

import { revalidatePath } from "next/cache"

import { FEE_BANDS, saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { saveScheduleOutcome, type SaveScheduleOutcome } from "./outcome"

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
