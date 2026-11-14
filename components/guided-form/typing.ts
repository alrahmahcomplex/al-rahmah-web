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

/**
 * A Discount code is three letters, a hyphen and three digits. Capitals, only
 * letters and digits kept, the hyphen added after the third, at most 7
 * characters: "aan132" becomes "AAN-132".
 */
export function formatCode(raw: string): string {
  const plain = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return plain.length > 3 ? `${plain.slice(0, 3)}-${plain.slice(3, 6)}` : plain
}
