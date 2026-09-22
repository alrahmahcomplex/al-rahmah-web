const FALLBACK = "/staff"
const PROBE_ORIGIN = "http://same-site.invalid"

// Turns an untrusted `next` query value into a path on this site. Anything
// that would leave the site (`//host`, `/\host`, `https://host`) or is not a
// path falls back to the staff home.
export function safeNextPath(next: string | null): string {
  if (!next?.startsWith("/")) return FALLBACK

  const url = new URL(next, PROBE_ORIGIN)
  if (url.origin !== PROBE_ORIGIN) return FALLBACK

  return url.pathname + url.search + url.hash
}
