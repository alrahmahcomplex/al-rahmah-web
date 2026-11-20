// The one-time greeting after an agent sets their password (#497 state 4).
// set-password sets this cookie to the Auth user id of the login whose
// password was just saved; the students page greets only while it names the
// verified session's own user id, and "Ona Wanafunzi Niliowaleta" clears it.
// A recreated record shares its code with the retired one, so a different
// Auth user holding that code never inherits the greeting; one that carries
// the same login forward keeps it, as that person's own.
// httpOnly and short-lived, so no address can bring the greeting back.
export const WELCOME_COOKIE = "agent-welcome"
export const WELCOME_PATH = "/discount-code/students"
export const WELCOME_MAX_AGE = 10 * 60
