// The HMAC key the e2e server signs self-confirm numbers with (#503), local
// only. The spec uses it to put a number it knows on an attempt, since the
// fake sender only logs the SMS.
export const E2E_OTP_HMAC_SECRET = "e2e-only-self-confirm-hmac-secret-0123456789"
