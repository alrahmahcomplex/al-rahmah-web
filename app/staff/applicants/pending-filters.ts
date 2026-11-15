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
 * Forgets the pending filters once any page of the list arrives: it is
 * either theirs, or one that replaced theirs (a search, Back, a newer
 * filter), since a newer navigation cancels an older one.
 */
export function settlePendingFilters() {
  if (pending) setPendingFilters(null)
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
