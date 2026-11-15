// The Applicants filters just chosen, while their page is still on its way.
// The top bar's search carries the list's filters so Clear returns to them;
// it reads the address, which still holds the old filters until the page
// arrives. A search made in that moment reads them from here instead (#324).

/** The filters as URL fields, for `href`: the address the list is going to. */
export type PendingFilters = { href: string; fields: [string, string][] }

let pending: PendingFilters | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function setPendingFilters(next: PendingFilters | null) {
  pending = next
  emit()
}

/**
 * Forgets the pending filters once their page (`href`) is the one shown, or
 * once a search's page is: a search made while they were on their way
 * carried them, and its page replaced theirs.
 */
export function settlePendingFilters(shownHref: string, searching: boolean) {
  if (pending && (searching || pending.href === shownHref)) setPendingFilters(null)
}

export function subscribePendingFilters(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readPendingFilters() {
  return pending
}

/** Nothing is pending while the server renders. */
export function readNoPendingFilters() {
  return null
}
