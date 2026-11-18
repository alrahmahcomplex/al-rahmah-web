import { MOST_STUDENTS, type Answers } from "./model"

// The Register students draft (#308, story 26): kept in the tab's
// sessionStorage, under the staff member's own key, so a failed save or a
// reload keeps the answers and they die with the tab. Every read and write is
// wrapped: with storage blocked the form works with no draft.
//
// Check-in (#309) keeps its own draft the same way, under its own prefix,
// with the family it is for: a draft for another family is not read.

const VERSION = 1
const REGISTER = "al-rahmah:register-students:"
const CHECK_IN = "al-rahmah:check-in:"
const prefixOf = (family?: string) => (family === undefined ? REGISTER : CHECK_IN)
const keyFor = (staffId: string, family?: string) => `${prefixOf(family)}${staffId}`

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** `family`: check-in's draft, for this family only. */
export function saveDraft(staffId: string, answers: Answers, family?: string) {
  try {
    storage()?.setItem(keyFor(staffId, family), JSON.stringify({ v: VERSION, answers, ...(family === undefined ? {} : { family }) }))
  } catch {
    // Full or blocked: the form carries on without a draft.
  }
}

export function clearDraft(staffId: string, family?: string) {
  try {
    storage()?.removeItem(keyFor(staffId, family))
  } catch {
    // Nothing to clear.
  }
}

/**
 * Another staff member's draft, left in this tab when they signed out, holds
 * a family's names and phone numbers: it goes as soon as this one's is read.
 */
function dropOtherDrafts(staffId: string) {
  try {
    const store = storage()
    if (!store) return
    const mine = [keyFor(staffId), keyFor(staffId, "")]
    const others: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && (key.startsWith(REGISTER) || key.startsWith(CHECK_IN)) && !mine.includes(key)) others.push(key)
    }
    for (const key of others) store.removeItem(key)
  } catch {
    // Blocked: nothing to remove.
  }
}

/** The stored answers, or null when there are none or they are not what this form wrote. Removes every other staff member's draft. */
export function readDraft(staffId: string, family?: string): Answers | null {
  dropOtherDrafts(staffId)
  try {
    const raw = storage()?.getItem(keyFor(staffId, family))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: unknown; answers?: Answers; family?: unknown }
    const a = parsed?.answers
    if (parsed?.family !== family) return null
    if (parsed?.v !== VERSION || !a || !Array.isArray(a.students) || a.students.length < 1 || a.students.length > MOST_STUDENTS) return null
    if (!a.students.every((s) => s && Number.isInteger(s.key))) return null
    if (typeof a.custodians !== "object" || !Array.isArray(a.onFileAsks) || typeof a.onFile !== "object") return null
    return a
  } catch {
    return null
  }
}
