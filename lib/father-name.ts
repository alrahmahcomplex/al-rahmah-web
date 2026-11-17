// The father's-name check, as the database runs it (normalize_father_name,
// word_edit_distance and father_name_match in supabase/migrations). The
// Register students form uses it to ask the right sibling question before it
// saves; the database checks again on save and decides. Keep the two equal:
// tests/unit/father-name.test.ts holds the database's own examples.

export type FatherNameMatch = "same" | "close" | "different"

/** Lower case, without . , ' ’ -, single spaces, trimmed. Empty reads as null. */
export function normalizeFatherName(name: string | null | undefined): string | null {
  const normal = (name ?? "")
    .toLowerCase()
    .replace(/[.,'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return normal === "" ? null : normal
}

/** The optimal-string-alignment distance: insertions, deletions, substitutions and neighbour swaps each count 1. */
export function wordEditDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  if (x.length === 0) return y.length
  if (y.length === 0) return x.length
  const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) best = Math.min(best, d[i - 2][j - 2] + 1)
      d[i][j] = best
    }
  }
  return d[x.length][y.length]
}

const sameWords = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((word, i) => word === b[i])

/**
 * Same, close or different; null when either name is missing.
 * Close: the same number of words with a total distance of at most 2 and at
 * most 1 on a word of 4 letters or fewer; or one name is the other plus one
 * extra final word (at least 2 shared); or plus one extra middle word, its
 * first and last kept (#400).
 */
export function fatherNameMatch(a: string | null | undefined, b: string | null | undefined): FatherNameMatch | null {
  const left = normalizeFatherName(a)
  const right = normalizeFatherName(b)
  if (left === null || right === null) return null
  if (left === right) return "same"

  const x = left.split(" ")
  const y = right.split(" ")
  if (x.length === y.length) {
    let total = 0
    for (let i = 0; i < x.length; i++) {
      const distance = wordEditDistance(x[i], y[i])
      if (distance > 1 && Math.min([...x[i]].length, [...y[i]].length) <= 4) return "different"
      total += distance
      if (total > 2) return "different"
    }
    return "close"
  }

  if (Math.abs(x.length - y.length) === 1) {
    const [shorter, longer] = x.length < y.length ? [x, y] : [y, x]
    if (shorter.length >= 2 && sameWords(longer.slice(0, shorter.length), shorter)) return "close"
    if (shorter.length >= 2) {
      for (let i = 1; i < longer.length - 1; i++) {
        if (sameWords([...longer.slice(0, i), ...longer.slice(i + 1)], shorter)) return "close"
      }
    }
  }
  return "different"
}
