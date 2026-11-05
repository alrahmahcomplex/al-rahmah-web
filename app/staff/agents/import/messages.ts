import { importFileMessage, type Bilingual } from "@/lib/import"
import type { AgentImportError } from "@/lib/services/agent-import"

// What the Manager reads when an import is refused. A file problem is
// bilingual; the rest is the staff side's English.
export type ImportMessage = { en: string; sw?: string }

// A check whose answer never arrived. It saves nothing, so trying again is
// safe. The form has cleared by then, so the file is chosen again.
export const CHECK_LOST: ImportMessage = { en: "The file could not be checked. Check your connection, choose the file again and check it." }

// A confirm whose answer never arrived, or that the database left unclear:
// the import may have been saved. Checking the same file again is safe and
// settles it: rows that were saved read as already present, and only rows
// still to create or add can be confirmed. A file name alone can't say
// whether this attempt saved, since an earlier import may share it.
export const CONFIRM_LOST: ImportMessage = {
  en:
    "We couldn't tell whether the import was saved. Reload this page, choose the same file and check it again. " +
    "Rows that were saved show as Already present, and you can confirm anything still to create. " +
    "Earlier imports also lists each import that was saved.",
}

export function importErrorMessage(error: AgentImportError | { kind: "signed-out" }): ImportMessage {
  switch (error.kind) {
    case "file":
      return importFileMessage(error.error) satisfies Bilingual
    case "signed-out":
      return { en: "You're signed out. Sign in again, then upload the file again." }
    case "forbidden":
      return { en: "Only staff who approve agents can import them." }
    case "invalid":
      return { en: "This check can't be saved as it is. Upload the file again." }
    case "nothing-to-import":
      return { en: "No row creates an agent or adds an email, so there is nothing to import." }
    case "conflict":
      return {
        en: "An agent was added or changed while the import was saving, so nothing was saved. Upload the file again to check it.",
      }
    case "unavailable":
      return { en: "The file could not be checked. Try again in a moment." }
    case "uncertain":
      return CONFIRM_LOST
  }
}
