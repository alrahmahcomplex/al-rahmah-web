import { BAND_NAMES, FEE_BANDS, type FeeField, type SaveFeeAmountsError } from "@/lib/services/fees"

// What the Fee schedule form is told after it saves.
export type SaveScheduleOutcome = { status: "saved" } | { status: "refused"; field: FeeField | null; message: string }

const ORDINAL = { first: "first", second: "second", third: "third" } as const

function bandMessage(field: string): string | null {
  const [band, kind] = field.split(".")
  const name = BAND_NAMES[band as (typeof FEE_BANDS)[number]]
  if (!name) return null
  const which = kind === "day_fee" ? "Day" : "Boarding"
  return `Enter the ${name} ${which} fee in whole shillings, above zero.`
}

const MESSAGE_OF: Partial<Record<FeeField, string>> = {
  enrollment_year: "Choose an enrollment year from 2000 to 2999.",
  split: "The three instalment shares must add up to 100%.",
  minimum_deposit: "Enter the minimum Initial deposit in whole shillings, above zero.",
  pre_form_one_day_fee: "Enter the Pre-Form One programme Day fee in whole shillings, above zero.",
  pre_form_one_boarding_fee: "Enter the Pre-Form One programme Boarding fee in whole shillings, above zero.",
  ...Object.fromEntries(
    (["first", "second", "third"] as const).map((n) => [
      `${n}_share`,
      `Enter the ${ORDINAL[n]} instalment's share as a whole percentage above zero.`,
    ]),
  ),
  first_due: "Enter the first instalment's due date.",
  second_due: "Enter the second instalment's due date, on or after the first's.",
  third_due: "Enter the third instalment's due date, on or after the second's.",
}

// Turns what the fees module refused into what the form shows.
export function saveScheduleOutcome(error: SaveFeeAmountsError): SaveScheduleOutcome {
  switch (error.kind) {
    case "invalid": {
      const message =
        (error.field && (MESSAGE_OF[error.field] ?? bandMessage(error.field))) ??
        "Some amounts could not be accepted. Check them and try again."
      return { status: "refused", field: error.field, message }
    }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't change the fee amounts." }
    case "unavailable":
      return {
        status: "refused",
        field: null,
        message: "The schedule could not be saved. Nothing was changed. Try again in a moment.",
      }
  }
}
