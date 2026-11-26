import type { ReactElement } from "react"

/**
 * One icon of set 1, "Two lines" (DESIGN.md, Icons): a 24px grid drawn with a
 * 2px round stroke. `outline` is the main object, drawn indigo when the icon
 * is active; `detail` is the second one (the calendar's days, the bell's
 * clapper), drawn orange. A utility glyph (back, right, check, plus, x) is one
 * line with no detail.
 */
export type IconDef = {
  readonly outline: ReactElement
  readonly detail?: ReactElement
}

/** Keeps each entry checked against IconDef where it is written. */
export const icon = (def: IconDef): IconDef => def

// The paths are copied from the approved prototype (version 13, app.js `IC`;
// the calendar from version 38). Do not redraw them; a new icon follows the
// same grid, splits into a main object and a detail, and is added here
// (DESIGN.md, Icons).

export const today = icon({
  outline: <path d="M8 3v3M16 3v3M20.5 11V8a3 3 0 0 0-3-3h-11a3 3 0 0 0-3 3v9.5a3 3 0 0 0 3 3H11" />,
  detail: <path d="m14 17.5 2.4 2.4 4.6-5" />,
})

export const checkin = icon({
  outline: <path d="M13 3.5h4.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H13" />,
  detail: <path d="M3.5 12h10M10 8.5l3.5 3.5-3.5 3.5" />,
})

export const register = icon({
  outline: (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 20.5c0-3.5 3-6 7-6 1.2 0 2.3.2 3.3.6" />
    </>
  ),
  detail: <path d="M18.5 14v7M15 17.5h7" />,
})

export const applicants = icon({
  outline: (
    <>
      <circle cx="9" cy="8" r="3.8" />
      <path d="M2.5 20.5c0-3.4 2.8-5.8 6.5-5.8s6.5 2.4 6.5 5.8" />
    </>
  ),
  detail: <path d="M15.6 4.4a3.8 3.8 0 0 1 0 7.2M18.5 15.2c1.9.9 3 2.8 3 5.3" />,
})

export const interviews = icon({
  outline: <path d="M9 4.5H7A2.5 2.5 0 0 0 4.5 7v11.5A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 17 4.5h-2M9.5 3h5v3h-5z" />,
  detail: <path d="m8.8 13.6 2.3 2.3 4.3-4.7" />,
})

export const followups = icon({
  outline: <path d="M6.8 3.5h2.4l1.4 3.8-1.9 1.4a11.5 11.5 0 0 0 6.1 6.1l1.4-1.9 3.8 1.4v2.4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.8 5.7a2 2 0 0 1 2-2.2z" />,
  detail: <path d="M14.5 3.6a6 6 0 0 1 5.9 5.9M14.5 7.2a2.4 2.4 0 0 1 2.3 2.3" />,
})

export const reapps = icon({
  outline: <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3" />,
  detail: <path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3" />,
})

export const agents = icon({
  outline: <path d="M4 9.5h3.5L17 5v14l-9.5-4.5H4z" />,
  detail: <path d="M20 9.4a3.8 3.8 0 0 1 0 5.2M8 14.8V19a1.5 1.5 0 0 0 3 0v-2.8" />,
})

export const promo = icon({
  outline: <path d="M3.5 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />,
  detail: <path d="m9.5 14.5 5-5M9.5 9.6h.01M14.5 14.4h.01" />,
})

export const groups = icon({
  outline: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z" />,
  detail: <path d="M8.5 9h7M8.5 12.5h4.4" />,
})

export const fees = icon({
  outline: <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h10.5A1.5 1.5 0 0 1 18 6.5V8h1a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 20H6a2.5 2.5 0 0 1-2.5-2.5z" />,
  detail: <path d="M3.8 8.5h10.7M16.3 14h.01" />,
})

export const seats = icon({
  outline: <path d="M7 12V5.5A2.5 2.5 0 0 1 9.5 3h5A2.5 2.5 0 0 1 17 5.5V12M6.5 16v5M17.5 16v5" />,
  detail: <path d="M4.5 12.5h15V16h-15z" />,
})

// A stream's label in the Change sheet's named field (owner, prototype v4, 26 Nov 2026):
// a luggage tag, its hole the detail.
export const tag = icon({
  outline: <path d="M3.5 12V5A1.5 1.5 0 0 1 5 3.5h7l8.5 8.5-8.5 8.5z" />,
  detail: <path d="M8 8h.01" />,
})

export const discounts = icon({
  outline: <path d="M20.7 9.8A9 9 0 1 1 14.2 3.3" />,
  detail: <path d="m8.8 15.2 6.4-6.4M9 9h.01M15 15h.01" />,
})

export const reopen = icon({
  outline: <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />,
  detail: <path d="M3 3v5h5M12 8.5V12l2.4 1.4" />,
})

export const reports = icon({
  outline: <path d="M5 20v-8M19 20v-5" />,
  detail: <path d="M12 20V4" />,
})

export const roles = icon({
  outline: <path d="M12 2.8 19.5 5.5v6c0 4.6-3 8-7.5 9.7C7.5 19.5 4.5 16.1 4.5 11.5v-6z" />,
  detail: <path d="m8.8 11.8 2.3 2.3 4.2-4.5" />,
})

export const audit = icon({
  outline: <path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5zM14 3v5.5h5.5" />,
  detail: <path d="M8.5 12.5h7M8.5 16.5h4" />,
})

export const search = icon({
  outline: <circle cx="11" cy="11" r="7" />,
  detail: <path d="m20 20-3.6-3.6" />,
})

export const bell = icon({
  outline: <path d="M6 10a6 6 0 0 1 12 0c0 4.5 1.8 6 1.8 6H4.2S6 14.5 6 10z" />,
  detail: <path d="M10 19.5a2.1 2.1 0 0 0 4 0" />,
})

export const panel = icon({
  outline: <path d="M7.5 4.5h9a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4z" />,
  detail: <path d="M9.5 5v14" />,
})

export const menu = icon({
  outline: <path d="M9.6 6.4h10M4.4 12h15.2" />,
  detail: <path d="M4.4 17.6h10.4" />,
})

export const back = icon({ outline: <path d="m15 18-6-6 6-6" /> })
export const right = icon({ outline: <path d="m9 18 6-6-6-6" /> })
export const check = icon({ outline: <path d="M20 6 9 17l-5-5" /> })
export const plus = icon({ outline: <path d="M12 5v14M5 12h14" /> })
export const x = icon({ outline: <path d="M18 6 6 18M6 6l12 12" /> })
export const up = icon({ outline: <path d="M12 19V5M6 11l6-6 6 6" /> })

export const pen = icon({
  outline: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  detail: <path d="M13.5 6.5l4 4" />,
})

export const reset = icon({
  outline: <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />,
  detail: <path d="M3 3v5h5" />,
})

export const alert = icon({
  outline: <circle cx="12" cy="12" r="10" />,
  detail: <path d="M12 8v4M12 16h.01" />,
})

export const info = icon({
  outline: <circle cx="12" cy="12" r="9" />,
  // The prototype's "M12 11v5M12 7.5v.01" as two paths, the way the
  // Admission form drew it, so the form's info icon stays pixel for pixel.
  detail: (
    <>
      <path d="M12 11v5" />
      <path d="M12 7.5v.01" />
    </>
  ),
})

export const phone = icon({
  outline: <path d="M6.8 3.5h2.4l1.4 3.8-1.9 1.4a11.5 11.5 0 0 0 6.1 6.1l1.4-1.9 3.8 1.4v2.4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.8 5.7a2 2 0 0 1 2-2.2z" />,
})

export const user = icon({
  outline: <circle cx="12" cy="8" r="4" />,
  detail: <path d="M4.5 20.5c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6" />,
})

export const school = icon({
  outline: <path d="M3.5 20.5V10L12 4l8.5 6v10.5" />,
  detail: <path d="M9.5 20.5V15h5v5.5" />,
})

// Version 38: the Home entry, the same house the prototype draws there. The
// house is the main object, its door the second.
export const house = icon({
  outline: <path d="M3.5 20.5V10L12 4l8.5 6v10.5" />,
  detail: <path d="M9.5 20.5V15h5v5.5" />,
})

export const link = icon({
  outline: <path d="M9.5 14.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />,
  detail: <path d="M14.5 9.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
})

// Version 18 (#358): the funnel of the Filter button. The cone is the main
// object, the spout the second.
export const filter = icon({
  outline: <path d="M3.8 5h16.4l-6.4 7.6h-3.6z" />,
  detail: <path d="M10.2 12.6v6l3.6 1.8v-7.8" />,
})

// The Admission form's own glyphs, not in the staff prototype. They keep the
// exact lines they had in components/guided-form/icons.tsx.

export const clock = icon({
  outline: <circle cx="12" cy="13" r="8" />,
  detail: (
    <>
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </>
  ),
})

export const globe = icon({
  outline: <circle cx="12" cy="12" r="9" />,
  detail: (
    <>
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </>
  ),
})

// Version 53: the region field's map pin (#511). The pin is the main object, its centre the second.
export const pin = icon({
  outline: <path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0z" />,
  detail: <circle cx="12" cy="10" r="3" />,
})

export const trash = icon({
  outline: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    </>
  ),
  detail: <path d="M9 7V4h6v3" />,
})

// The form parts' glyphs (version 18, #358): the choice list's chevron and
// the file area's upload arrow, one line each, and the date field's calendar,
// which version 38 draws in two lines like the rest of set 1.

export const down = icon({ outline: <path d="m6 9 6 6 6-6" /> })

export const calendar = icon({
  outline: <path d="M8 3v3M16 3v3M6.5 5h11a3 3 0 0 1 3 3v9.5a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />,
  detail: <path d="M3.8 10h16.4M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01" />,
})

export const upload = icon({
  outline: (
    <>
      <path d="M12 15.5V4.5M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </>
  ),
})

// The agents app's glyphs (#539, prototype v5): copy, chat (WhatsApp share),
// and signout (moving out / leaving). Two lines each, 24px grid, 2px stroke.
export const copy = icon({
  outline: <rect x="8" y="8" width="12" height="12" rx="2.5" />,
  detail: <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />,
})

export const chat = icon({
  outline: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z" />,
  detail: <path d="M8.5 9h7M8.5 12.5h4.4" />,
})

export const signout = icon({
  outline: <path d="M20 4v16" />,
  detail: <path d="M4 12h12M12 7l5 5-5 5" />,
})

// The agent sign-up's step discs (owner, prototype v5, 25 Nov 2026): a padlock
// (choose how to sign in, set your password), an envelope (the email path), and
// a message with three stars inside, a secret code sent by SMS.
export const lock = icon({
  outline: <rect x="4" y="10" width="16" height="11" rx="2.5" />,
  detail: <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2.5" />,
})

export const mail = icon({
  outline: <rect x="3" y="5" width="18" height="14" rx="2.5" />,
  detail: <path d="m3.5 7 8.5 6 8.5-6" />,
})

export const smscode = icon({
  outline: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z" />,
  // Thin stars, spaced so they never touch (owner, prototype v7, 26 Nov 2026).
  detail: (
    <path
      strokeWidth={0.75}
      d="M7.6 8.5v3.5M6.084 9.375l3.032 1.75M6.084 11.125l3.032-1.75M12 8.5v3.5M10.484 9.375l3.032 1.75M10.484 11.125l3.032-1.75M16.4 8.5v3.5M14.884 9.375l3.032 1.75M14.884 11.125l3.032-1.75"
    />
  ),
})

export const ICONS = {
  today,
  checkin,
  register,
  applicants,
  interviews,
  followups,
  reapps,
  agents,
  promo,
  groups,
  fees,
  seats,
  discounts,
  reopen,
  reports,
  roles,
  audit,
  search,
  bell,
  panel,
  menu,
  back,
  right,
  check,
  plus,
  x,
  reset,
  alert,
  info,
  phone,
  user,
  school,
  house,
  link,
  filter,
  clock,
  globe,
  trash,
  down,
  calendar,
  upload,
  up,
  pen,
  pin,
  copy,
  chat,
  signout,
  lock,
  mail,
  smscode,
  tag,
} satisfies Record<string, IconDef>

export type IconName = keyof typeof ICONS
