// Where the stage was scrolled, per history entry, so Back returns to the
// same place. Each entry gets its own key in history.state, next to Next.js's
// own fields (a state that carries __NA passes through Next's patched
// replaceState untouched). The positions live for the tab's life.

const KEY = "staffScrollKey"
const positions = new Map<string, number>()

function entryKey(): string {
  const state = window.history.state as Record<string, unknown> | null
  const existing = state?.[KEY]
  if (typeof existing === "string") return existing
  const key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  window.history.replaceState({ ...state, [KEY]: key }, "")
  return key
}

/** Remembers the current entry's scroll position. */
export function rememberScroll(top: number): void {
  positions.set(entryKey(), top)
}

/** The position saved for the current entry: a Back or Forward to it. Undefined for a new entry. */
export function savedScroll(): number | undefined {
  return positions.get(entryKey())
}
