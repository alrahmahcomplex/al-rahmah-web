import { MOST_STUDENTS, type Answers } from "./model"

// The Register students draft (#308, story 26): kept in the tab's
// sessionStorage, under the staff member's own key, so a failed save or a
// reload keeps the answers and they die with the tab. Every read and write is
// wrapped: with storage blocked the form works with no draft.

const VERSION = 1
const PREFIX = "al-rahmah:register-students:"
const keyFor = (staffId: string) => `${PREFIX}${staffId}`

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function saveDraft(staffId: string, answers: Answers) {
  try {
    storage()?.setItem(keyFor(staffId), JSON.stringify({ v: VERSION, answers }))
  } catch {
    // Full or blocked: the form carries on without a draft.
  }
}

export function clearDraft(staffId: string) {
  try {
    storage()?.removeItem(keyFor(staffId))
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
    const mine = keyFor(staffId)
    const others: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && key.startsWith(PREFIX) && key !== mine) others.push(key)
    }
    for (const key of others) store.removeItem(key)
  } catch {
    // Blocked: nothing to remove.
  }
}

/** The stored answers, or null when there are none or they are not what this form wrote. Removes every other staff member's draft. */
export function readDraft(staffId: string): Answers | null {
  dropOtherDrafts(staffId)
  try {
    const raw = storage()?.getItem(keyFor(staffId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: unknown; answers?: Answers }
    const a = parsed?.answers
    if (parsed?.v !== VERSION || !a || !Array.isArray(a.students) || a.students.length < 1 || a.students.length > MOST_STUDENTS) return null
    if (!a.students.every((s) => s && Number.isInteger(s.key))) return null
    if (typeof a.custodians !== "object" || !Array.isArray(a.onFileAsks) || typeof a.onFile !== "object") return null
    return a
  } catch {
    return null
  }
}
