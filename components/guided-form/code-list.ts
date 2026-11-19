// The rules behind CodePicker's list and its faint completion: the order the
// codes are listed in, what a search matches, and which code the typed
// letters complete to. No React here, so they can be tested alone.

/** One code in the list: a Promo code or an agent's code, with the line shown beside it. */
export type CodeOption = { kind: "promo" | "agent"; code: string; detail: string }

/** A code as compared: capitals, without the hyphen formatCode puts after three letters, so EID-2026 and EID2026 are one code. */
export function codeKey(code: string): string {
  return code.toUpperCase().replace(/^([A-Z]{3})-(?=[0-9])/, "$1")
}

/** Promo codes first, then agent codes, each A to Z by code. */
export function sortCodeOptions(options: readonly CodeOption[]): CodeOption[] {
  const rank = (option: CodeOption) => (option.kind === "promo" ? 0 : 1)
  return [...options].sort((a, b) => rank(a) - rank(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

/** The codes a search finds: the code or the line beside it holds what was typed, ignoring case, spaces and the agent hyphen. */
export function filterCodeOptions(query: string, options: readonly CodeOption[]): CodeOption[] {
  const words = query.trim().toLowerCase()
  if (words === "") return [...options]
  const typedKey = codeKey(words.replace(/\s+/g, ""))
  return options.filter((option) => codeKey(option.code).includes(typedKey) || option.detail.toLowerCase().includes(words))
}

/**
 * What the box shows when `typed` begins a listed code: the typed letters
 * as they are, then the rest of the first such code in list order. Null when
 * no code begins with them, or when they already are a listed code, so a
 * whole code (SAVE10) is never swapped for a longer one (SAVE100).
 */
export function completeCode(typed: string, options: readonly CodeOption[]): string | null {
  if (typed === "") return null
  const typedKey = codeKey(typed)
  if (options.some((option) => codeKey(option.code) === typedKey)) return null
  for (const option of options) {
    if (option.code.length > typed.length && option.code.toUpperCase().startsWith(typed.toUpperCase())) return typed + option.code.slice(typed.length)
    const key = codeKey(option.code)
    if (key.length > typedKey.length && key.startsWith(typedKey)) return typed + key.slice(typedKey.length)
  }
  return null
}
