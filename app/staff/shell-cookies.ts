// The sidebar as the person left it, kept in cookies so the server renders
// the first paint that way and nothing flashes. The browser writes them when
// the sidebar is folded or resized; app/staff/layout.tsx reads them (never
// the root layout, ADR 0006) through parseSidebarCookies.

// Whether the sidebar is folded to its icons, "1" or "0". Both shells read it.
export const SIDEBAR_RAIL_COOKIE = "staff-sidebar-rail"
// The open width the new shell's sidebar was dragged to, in whole pixels.
// No cookie means the narrowest width, which the browser measures.
export const SIDEBAR_WIDTH_COOKIE = "staff-sidebar-width"
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

// What the server accepts from the width cookie. The real limits depend on
// the labels and the window, so the browser clamps again to those; this
// range only keeps a broken or edited cookie from drawing a silly first paint.
export const SIDEBAR_WIDTH_BOUNDS = { min: 120, max: 600 } as const

export type SidebarCookies = { folded: boolean; width: number | null }

/** The two sidebar cookies' raw values, read safely: anything unexpected means the default. */
export function parseSidebarCookies(rail: string | undefined, width: string | undefined): SidebarCookies {
  const value = width?.trim() ?? ""
  const pixels = /^\d{1,6}(\.\d+)?$/.test(value) ? Math.round(Number(value)) : NaN
  return {
    folded: rail === "1",
    width: Number.isFinite(pixels) && pixels > 0 ? Math.min(SIDEBAR_WIDTH_BOUNDS.max, Math.max(SIDEBAR_WIDTH_BOUNDS.min, pixels)) : null,
  }
}

/** A cookie the browser keeps for a year on every staff page. */
export function sidebarCookie(name: string, value: string): string {
  return `${name}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
}

/** Removes a sidebar cookie, so the default applies again. */
export function clearedSidebarCookie(name: string): string {
  return `${name}=; path=/; max-age=0; samesite=lax`
}
