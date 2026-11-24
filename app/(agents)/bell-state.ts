import type { AgentRecentChange } from "@/lib/services/agent-students"

// Device-only unread state for the agents bell (#539): one ISO timestamp in
// localStorage behind try/catch. No Set, no entry cap, and no database table.
export const BELL_LAST_OPENED_KEY = "ar-agents-bell-opened-v1"

const bellListeners = new Set<() => void>()

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// Entries whose change time is strictly after `lastOpenedAt` count as unread.
// When `lastOpenedAt` is missing or invalid (first visit, or device storage is
// unavailable), everything in the 7-day window counts as unread.
export function countUnreadRecent(recent: readonly Pick<AgentRecentChange, "changedAt">[], lastOpenedAt: string | null): number {
  const openedMs = parseTimestamp(lastOpenedAt)
  if (openedMs === null) return recent.length
  let unread = 0
  for (const item of recent) {
    const changedMs = parseTimestamp(item.changedAt)
    if (changedMs === null || changedMs > openedMs) unread += 1
  }
  return unread
}

// Timestamp written when the bell opens: the newest change time among the
// entries just shown, never the device clock. A change made after the page
// loaded is not in `recent`, so it stays unread after a reload; a phone clock
// running ahead cannot hide later changes. Keeps `previous` when it is newer,
// and returns null when there is nothing to save.
export function openedAtFor(recent: readonly Pick<AgentRecentChange, "changedAt">[], previous: string | null): string | null {
  let latest = parseTimestamp(previous)
  for (const item of recent) {
    const changedMs = parseTimestamp(item.changedAt)
    if (changedMs !== null && (latest === null || changedMs > latest)) latest = changedMs
  }
  return latest === null ? null : new Date(latest).toISOString()
}

export function readLastOpenedAt(): string | null {
  try {
    const raw = window.localStorage.getItem(BELL_LAST_OPENED_KEY)
    return parseTimestamp(raw) !== null ? raw : null
  } catch {
    return null
  }
}

export function subscribeLastOpenedAt(listener: () => void) {
  bellListeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === BELL_LAST_OPENED_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    bellListeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function writeLastOpenedAt(iso: string) {
  try {
    window.localStorage.setItem(BELL_LAST_OPENED_KEY, iso)
  } catch {
    // Device storage may be blocked in private mode; ignore silently.
  }
  bellListeners.forEach((listener) => listener())
}
