// Whether the sidebar is folded to its icon rail, as a cookie, so the server
// renders the first paint the way the person left it and nothing flashes. The
// browser writes it when the toggle is pressed; the layout's next render reads it.
export const SIDEBAR_RAIL_COOKIE = "staff-sidebar-rail"
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
