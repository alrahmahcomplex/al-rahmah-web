// The one page every password reset link lands on (#265), staff's and
// agents', since Supabase has one recovery email template for the project.
// The hosted Redirect URLs allow-list must hold it for every site address.
// Links to the old agent reset page (/discount-code/reset-password) are sent
// here by next.config.ts, token and all.
export const RESET_PATH = "/login/reset-password"
