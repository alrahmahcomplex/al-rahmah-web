import { BAND_CLASSES, type FeeBand } from "@/lib/services/fees"

// Whole shillings with thousands separators, such as 1,100,000.
export function formatShillings(amount: number): string {
  return new Intl.NumberFormat("en-US").format(amount)
}

// The classes in a band, such as "STD 1 to STD 4" or "DAY CARE, KG 1, KG 2".
export function bandClasses(band: FeeBand): string {
  const classes = BAND_CLASSES[band]
  return classes.length > 3 ? `${classes[0]} to ${classes[classes.length - 1]}` : classes.join(", ")
}
