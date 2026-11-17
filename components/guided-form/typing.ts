import { AGENT_CODE_PATTERN, DISCOUNT_CODE_MAX_LENGTH } from "@/lib/discount-code-rules"

// What the name boxes and the code box do to what is typed (prototype v38,
// "names in three boxes" and "Discount codes get their hyphen by themselves").
// Plain functions, so the rules are tested without a browser.

/**
 * The boxes' values after `raw` is typed or pasted into box `index`. A space
 * ends a box: what follows it moves to the next box, in front of what that box
 * already holds, so a pasted full name spreads across the boxes. The last box
 * keeps its spaces (BIN SALIM). A space at the very start of a box is dropped.
 * Everything is in capitals. `focus` is the box the caret should move to, or
 * null to stay.
 */
export function typeInNameBox<K extends string>(keys: readonly K[], values: Readonly<Record<K, string>>, index: number, raw: string): { values: Record<K, string>; focus: number | null } {
  const next = { ...values } as Record<K, string>
  const last = keys.length - 1
  let i = index
  let text = raw
  let focus: number | null = null
  for (;;) {
    const key = keys[i]
    if (i >= last || !/\s/.test(text)) {
      next[key] = text.toUpperCase()
      return { values: next, focus }
    }
    const m = text.match(/^\s*(\S*)\s+([\s\S]*)$/)
    if (!m || !m[1]) {
      next[key] = text.replace(/\s+/g, "").toUpperCase()
      return { values: next, focus }
    }
    next[key] = m[1].toUpperCase()
    const rest = m[2].trim()
    focus = i + 1
    if (!rest) return { values: next, focus }
    const held = next[keys[i + 1]]
    text = held ? `${rest} ${held}` : rest
    i += 1
  }
}

/** A name as it is saved: capitals, single spaces, no space at either end. */
export const cleanName = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase()

/** "Who brought the students" needs at least two names. */
export const hasTwoNames = (value: string) => cleanName(value).split(" ").filter(Boolean).length >= 2

/** The longest code the database reads (`normalize_referral_code`). */
export const CODE_MAX_LENGTH = DISCOUNT_CODE_MAX_LENGTH

export { AGENT_CODE_PATTERN }

/**
 * The Admission form's code box, which takes an agent's code or a Promo
 * code. Capitals, no spaces, and only printable characters kept. Three
 * letters followed by a digit get the agent hyphen between them, so
 * "aan132" becomes "AAN-132". A hyphen typed again after three letters is
 * dropped ("ABC--1" becomes "ABC-1"; no Promo code starts that way). Any
 * other shape stays as typed, such as SAVE10, KARIBU2026, AS-135 or $AVE, up
 * to 20 characters, the hyphen included. The form looks a code up
 * as typed and then without that hyphen, so a Promo code like EID2026 still
 * matches.
 */
export function formatCode(raw: string): string {
  const plain = raw.toUpperCase().replace(/[^!-~]/g, "").replace(/^([A-Z]{3})-{2,}/, "$1-")
  return plain.replace(/^([A-Z]{3})(?=[0-9])/, "$1-").slice(0, CODE_MAX_LENGTH)
}

/**
 * A box that takes only an agent's code, ABC-123: the first three letters,
 * then the first three digits, in capitals; anything else is dropped. The
 * hyphen goes in by itself after the third letter, and one typed again is
 * ignored. `previous` is the box's value before this change: when the
 * change deletes the hyphen after the three letters, it stays deleted, so
 * the letters can be corrected.
 */
export function formatAgentCode(raw: string, previous = ""): string {
  let letters = ""
  let digits = ""
  for (const ch of raw.toUpperCase()) {
    if (letters.length < 3) {
      if (/[A-Z]/.test(ch)) letters += ch
    } else if (digits.length < 3 && /[0-9]/.test(ch)) digits += ch
  }
  if (letters.length < 3) return letters
  if (digits) return `${letters}-${digits}`
  const deleting = raw.length < previous.length
  return deleting && !raw.toUpperCase().endsWith("-") ? letters : `${letters}-`
}
