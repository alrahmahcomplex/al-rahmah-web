// The Referral link (`/apply?ref=<code>`) and the 30 days the Admission form
// remembers its code. Pure, so the page (on the server), the form (in the
// browser) and the tests share one set of rules. The page calls the code a
// Discount code, and so does everything a parent can see, the cookie's name
// included.

// The cookie holding the code from the latest Referral link followed.
export const DISCOUNT_CODE_COOKIE = "discount_code"

// 30 days, in seconds, counted from the latest link followed.
export const DISCOUNT_CODE_MAX_AGE = 30 * 24 * 60 * 60

// The interview fee per child when no confirmed code brings it down, in whole
// TZS: what the form shows before a code is checked, or when the check can't
// run. The database's interview_fee() holds the amounts; an integration test
// keeps this equal to what discount_code_estimate returns for a code it
// doesn't recognise.
export const STANDARD_INTERVIEW_FEE = 50000

// A code as the database normalizes it (normalize_referral_code): every
// space removed, uppercased, then 1 to 20 letters A to Z, digits, `-` and
// `.`. Null for anything else, which is not a code.
export function normalizeDiscountCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.replace(/\s/g, "").toUpperCase()
  return /^[A-Z0-9.-]{1,20}$/.test(code) ? code : null
}

// The Set-Cookie value the form writes when it opens from a Referral link.
// Not HttpOnly, since the page writes it; Secure on https.
export function discountCodeCookie(code: string, { secure }: { secure: boolean }): string {
  const cookie = `${DISCOUNT_CODE_COOKIE}=${code}; Max-Age=${DISCOUNT_CODE_MAX_AGE}; Path=/; SameSite=Lax`
  return secure ? `${cookie}; Secure` : cookie
}

// Where the Discount code field starts: the link's code, then the remembered
// one, then empty. `remember` is the code to (re)write to the cookie: the
// link's, when the visit came through one, so the latest link wins and its
// 30 days start again. A visit without a link leaves the cookie alone.
export function initialDiscountCode({
  ref,
  cookie,
}: {
  // The `ref` search parameter: a list when the URL carries it twice.
  ref: string | string[] | undefined
  cookie: string | undefined
}): { code: string; remember: string | null } {
  const linked = normalizeDiscountCode(ref)
  if (linked) return { code: linked, remember: linked }
  return { code: normalizeDiscountCode(cookie) ?? "", remember: null }
}
