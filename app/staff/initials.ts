// A student's initials for the mark beside their name: the first letters of
// their first and last names.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ""
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}
