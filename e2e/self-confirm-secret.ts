// The HMAC key the e2e server signs self-confirm numbers with (#503), local
// only. The spec uses it to put a number it knows on an attempt, since the
// fake sender only logs the SMS. It is .env.local's key when there is one
// (tests/support/env loads it first), so a server started by hand with
// `npm run e2e:serve` and reused by Playwright signs with the same key; else
// .env.example's.
export const E2E_OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET ?? "local-only-self-confirm-hmac-key-0123456789"
