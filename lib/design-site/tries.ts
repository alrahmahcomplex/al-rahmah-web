// Wrong passwords on the design site's lock screen: five in ten minutes from
// one address, then a wait (prototype v6). Kept in the server's memory, with
// no database, so the site needs nothing but its own code. Each server
// instance counts on its own and forgets on a restart: this slows a guesser
// down, it does not stop a determined one. The password does that; the site
// shows no family data.

export const MAX_TRIES = 5
export const TRY_WINDOW_MS = 10 * 60 * 1000
const MAX_TRACKED = 5000

type Count = { wrong: number; since: number }

export type TryLimiter = {
  /** Whether this address must wait before trying again. */
  blocked(address: string, now?: number): boolean
  /** Counts a wrong password. */
  wrong(address: string, now?: number): void
  /** A right password clears the count. */
  clear(address: string): void
}

export function tryLimiter(): TryLimiter {
  const counts = new Map<string, Count>()
  const live = (address: string, now: number): Count | undefined => {
    const count = counts.get(address)
    if (count && now - count.since >= TRY_WINDOW_MS) {
      counts.delete(address)
      return undefined
    }
    return count
  }
  return {
    blocked(address, now = Date.now()) {
      return (live(address, now)?.wrong ?? 0) >= MAX_TRIES
    },
    wrong(address, now = Date.now()) {
      const count = live(address, now)
      if (count) count.wrong += 1
      else {
        // Forget the oldest address first, so memory stays small.
        if (counts.size >= MAX_TRACKED) counts.delete(counts.keys().next().value as string)
        counts.set(address, { wrong: 1, since: now })
      }
    },
    clear(address) {
      counts.delete(address)
    },
  }
}

/** The one limiter this server instance uses. */
export const designTries = tryLimiter()
