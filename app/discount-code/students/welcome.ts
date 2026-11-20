// The one-time greeting after an agent sets their password (#497 state 4).
// set-password sets this cookie to the agent's own code; the students page
// greets only while it names the signed-in agent's code, and "Ona Wanafunzi
// Niliowaleta" clears it. httpOnly and short-lived, so no address can bring
// the greeting back.
export const WELCOME_COOKIE = "agent-welcome"
export const WELCOME_PATH = "/discount-code/students"
export const WELCOME_MAX_AGE = 10 * 60
