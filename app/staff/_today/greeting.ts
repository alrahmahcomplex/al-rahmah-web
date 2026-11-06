// The words at the top of Today.

// "Good morning" until noon in Tanzania, "Good afternoon" after it.
export function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : "Good afternoon"
}

// The first word of a staff member's name, as a colleague would greet them.
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

// A student's initials for the mark beside their name: the first letters of
// their first and last names.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ""
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}
