// Shared timing for concept C. The CSS custom properties in guided-form.css
// carry the same numbers; JavaScript needs them for timeouts.

/** True when the visitor asked for less motion (OS setting or `html.rm`). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  if (document.documentElement.classList.contains("rm")) return true
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** How long a card takes to fold or unfold, in ms (0 under reduced motion). */
export function foldMs(): number {
  return prefersReducedMotion() ? 0 : 300
}

/** A short buzz on phones that support it, skipped under reduced motion. */
export function buzz(): void {
  try {
    if (!prefersReducedMotion()) navigator.vibrate?.(25)
  } catch {
    // Some browsers throw when vibration is blocked; it is only a flourish.
  }
}
