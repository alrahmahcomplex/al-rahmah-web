// The rules behind TypeAheadField (#511, prototype v53): which option the
// typed letters complete to, which keys take that completion, and what the
// list's search finds. No React here, so they are tested alone.

/** One option: what is saved, and what the box and the list show. */
export type TypeAheadOption = { value: string; label: string }

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/^ /, "")

/** The options whose label begins with the typed letters, ignoring case and spaces at the start. None for nothing typed. */
export function startsWith(options: readonly TypeAheadOption[], typed: string): TypeAheadOption[] {
  const t = fold(typed)
  return t === "" ? [] : options.filter((o) => o.label.toLowerCase().startsWith(t))
}

/** The option whose label is exactly what was typed, ignoring case and spaces at either end. */
export function exactly(options: readonly TypeAheadOption[], typed: string): TypeAheadOption | null {
  const t = fold(typed).trimEnd()
  return t === "" ? null : (options.find((o) => o.label.toLowerCase() === t) ?? null)
}

/**
 * The faint completion: the label of the first option the typed letters
 * begin, when it is longer than what was typed. Null when nothing is typed,
 * nothing matches, or the typed letters already are a whole label.
 */
export function completion(options: readonly TypeAheadOption[], typed: string): TypeAheadOption | null {
  const first = startsWith(options, typed)[0]
  return first && first.label.length > fold(typed).length ? first : null
}

/** The rest of the completion drawn after the typed letters, exactly as they were typed. Empty when it doesn't continue them. */
export function restOf(typed: string, label: string): string {
  return typed !== "" && label.length > typed.length && label.toLowerCase().startsWith(typed.toLowerCase()) ? label.slice(typed.length) : ""
}

/**
 * Whether a key takes the faint completion: Right arrow with the caret at
 * the end, Tab (not Shift+Tab), Enter, and Space only when one option fits.
 */
export function takesCompletion(
  key: string,
  { shift = false, caretAtEnd = true, fits = 0 }: { shift?: boolean; caretAtEnd?: boolean; fits?: number },
): boolean {
  if (key === "ArrowRight") return caretAtEnd
  if (key === "Tab") return !shift
  if (key === "Enter") return true
  if (key === " ") return fits === 1
  return false
}

/** What the list's search box finds: options whose label holds the words, ignoring case. Every option for an empty search. */
export function search(options: readonly TypeAheadOption[], query: string): TypeAheadOption[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ")
  return q === "" ? [...options] : options.filter((o) => o.label.toLowerCase().includes(q))
}
