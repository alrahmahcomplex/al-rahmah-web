// The Roles page asks before its unsaved changes are left behind. The pane
// registers here while it has changes; another part of the page that moves
// away by itself (New role opening the role it made) asks it first.

type Guard = (to: string) => void

let guard: Guard | null = null

export function setLeaveGuard(next: Guard | null) {
  guard = next
}

/** True when the pane took over: it asks, then goes to `to` itself. */
export function askBeforeLeaving(to: string): boolean {
  if (!guard) return false
  guard(to)
  return true
}
