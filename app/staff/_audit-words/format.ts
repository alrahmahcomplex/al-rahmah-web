import { formatDate } from "@/lib/school-calendar"

// Shared formatting for the Audit page and Application history (#504).
// The school is in Tanzania, so times read in East Africa Time.

const AUDIT_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

export function formatAuditTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : AUDIT_TIME.format(date)
}

export function formatAuditDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value)
  return formatRawScalar(value)
}

export function formatTzs(value: unknown): string {
  const num = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN
  return Number.isFinite(num) ? `TZS ${num.toLocaleString("en-US")}` : formatRawScalar(value)
}

export function formatPercent(value: unknown): string {
  const num = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN
  return Number.isFinite(num) ? `${num}%` : formatRawScalar(value)
}

export function formatYesNo(value: unknown): string {
  if (value === true || value === "true") return "Yes"
  if (value === false || value === "false") return "No"
  return formatRawScalar(value)
}

export function formatOnOff(value: unknown): string {
  if (value === true || value === "true") return "On"
  if (value === false || value === "false") return "Off"
  return formatRawScalar(value)
}

export function formatRawScalar(value: unknown): string {
  if (value === null || value === undefined) return "None"
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return JSON.stringify(value)
}

export function capitalize(sentence: string): string {
  if (!sentence) return sentence
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
