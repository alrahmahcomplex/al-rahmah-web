import { importFileMessage, type Bilingual, type ImportFileError } from "@/lib/import"
import type { StudentImportClass, StudentImportSummary } from "@/lib/student-import"

// The words of the applicant import sheet that depend on what came back:
// refusals, the review's chips and the counts on its buttons. A file problem
// is bilingual, as in the agent import; the rest is the staff side's English.

export type ImportMessage = { en: string; sw?: string }

// The refusals the sheet words, as the import service and the actions name
// them. File problems carry the import module's own error.
export type StudentImportRefusal =
  | { kind: "file"; error: ImportFileError }
  | { kind: "signed-out" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "nothing-to-import" }
  | { kind: "unavailable" }
  | { kind: "uncertain" }

// A check whose answer never arrived. It saves nothing, so trying again is
// safe; the file is chosen again.
export const CHECK_LOST: ImportMessage = { en: "The file could not be checked. Check your connection, then choose the file again." }

// A confirm whose answer never arrived, or that the database left unclear:
// the import may have been saved. Checking the same file again settles it,
// since rows that were saved come back as Already present.
export const CONFIRM_LOST: ImportMessage = {
  en:
    "We couldn't tell whether the import was saved. Close this, open Import again and check the same file. " +
    "Rows that were saved show as Already present, and you can create anything still to create.",
}

export function importErrorMessage(error: StudentImportRefusal): ImportMessage {
  switch (error.kind) {
    case "file":
      return importFileMessage(error.error) satisfies Bilingual
    case "signed-out":
      return { en: "You're signed out. Sign in again, then choose the file again." }
    case "forbidden":
      return { en: "Only staff who may import applicants can do this." }
    case "invalid":
      return { en: "This check can't be saved as it is. Choose the file again." }
    case "nothing-to-import":
      return { en: "No row creates an applicant, so there is nothing to import." }
    case "unavailable":
      return { en: "The file could not be checked. Try again in a moment." }
    case "uncertain":
      return CONFIRM_LOST
  }
}

// Each review class: its chip label and tint. The tints are the status
// chips' soft pairs, so they read at 4.5:1 or more.
export const CLASS_LABELS: Record<StudentImportClass, string> = {
  create: "To create",
  "joins-family": "Joins a family",
  present: "Already present",
  flagged: "Flagged",
  refused: "Refused",
}

export const CLASS_TONES: Record<StudentImportClass, string> = {
  create: "bg-green-50 text-green-800",
  "joins-family": "bg-blue-50 text-blue-700",
  present: "bg-slate-100 text-slate-700",
  flagged: "bg-amber-50 text-amber-900",
  refused: "bg-red-50 text-red-700",
}

// The order the summary chips come in.
const CHIP_ORDER: readonly StudentImportClass[] = ["create", "joins-family", "present", "flagged", "refused"]

const count = (n: number) => n.toLocaleString("en-US")

// "4 to create", "1 joins a family" and so on, for the classes the file has.
export function summaryChips(summary: StudentImportSummary): { class: StudentImportClass; label: string }[] {
  return CHIP_ORDER.filter((c) => summary[c] > 0).map((c) => {
    const label = c === "joins-family" ? (summary[c] === 1 ? "joins a family" : "join a family") : CLASS_LABELS[c].toLowerCase()
    return { class: c, label: `${count(summary[c])} ${label}` }
  })
}

// The rows the import saves: new applicants and those joining a family.
export function toCreate(summary: StudentImportSummary): number {
  return summary.create + summary["joins-family"]
}

// The rows written to the skipped-rows file: refused and flagged. Rows
// already present are left out, since uploading them again changes nothing.
export function skippedFileRows(summary: StudentImportSummary): number {
  return summary.refused + summary.flagged
}

export function createLabel(summary: StudentImportSummary): string {
  const n = toCreate(summary)
  return n === 1 ? "Create 1 applicant" : `Create ${count(n)} applicants`
}

export function skippedRowsLabel(n: number): string {
  return n === 1 ? "Download the 1 skipped row" : `Download the ${count(n)} skipped rows`
}

export function rowsChecked(n: number): string {
  return n === 1 ? "1 row checked" : `${count(n)} rows checked`
}

// The Done step's title. The database counts new applicants and those that
// joined a family apart; both were created.
export function doneTitle(outcome: { created: number; joinedFamily: number; skipped: number }): string {
  const created = outcome.created + outcome.joinedFamily
  return `${count(created)} ${created === 1 ? "applicant" : "applicants"} created, ${count(outcome.joinedFamily)} joined a family, ${count(outcome.skipped)} skipped.`
}

export function changedTitle(n: number): string {
  return `${n === 1 ? "1 row changed" : `${count(n)} rows changed`} since you checked, so nothing was saved`
}

// The skipped rows' file name, beside the uploaded one.
export function skippedFileName(fileName: string): string {
  return `${fileName.replace(/\.csv$/i, "")}-skipped.csv`
}
