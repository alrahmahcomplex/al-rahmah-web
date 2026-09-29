// Supabase's minimum_password_length (supabase/config.toml). The invite form
// and the invite service both check it before the token is used, so a short
// password never spends the invite.
export const MINIMUM_PASSWORD_LENGTH = 6
