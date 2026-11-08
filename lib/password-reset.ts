// The one page every password reset link lands on (#265), staff's and
// agents', since Supabase has one recovery email template for the project.
// The hosted Redirect URLs allow-list must hold it for every site address.
// Links to the old agent reset page (/discount-code/reset-password) are sent
// here by next.config.ts, token and all.
export const RESET_PATH = "/login/reset-password"

// Names the link this browser already spent and the account it signed in,
// when saving the new password failed after that: "<token_hash> <user id>".
export const RESET_VERIFIED_COOKIE = "reset-link-verified"

// The retry the cookie allows: the same link, and the account it signed in.
export function retryFor(cookie: string | undefined, tokenHash: string): string | null {
  const [token, userId] = (cookie ?? "").split(" ")
  return token === tokenHash && userId ? userId : null
}
