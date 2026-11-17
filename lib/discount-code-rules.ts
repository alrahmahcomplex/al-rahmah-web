// The shapes of Discount codes, as the database holds them
// (normalize_referral_code, discount_code_key and the Promo code check in
// 20261229100100_promo_any_format_agent_code_shape.sql). Pure, so the staff
// screens, the Admission form and the tests share them.

/** The longest code the database reads. */
export const DISCOUNT_CODE_MAX_LENGTH = 20

/** The longest Promo code (owner, 2026-11-17). The database holds the same limit. */
export const PROMO_CODE_MAX_LENGTH = 15

/** An agent's code: three letters, a hyphen and three digits. */
export const AGENT_CODE_PATTERN = /^[A-Z]{3}-[0-9]{3}$/

/** A code as typed, the way the database stores it: no spaces, capitals. */
export function cleanDiscountCode(typed: string): string {
  return typed.replace(/\s/g, "").toUpperCase()
}

/**
 * Whether a cleaned code can be a Promo code: 1 to PROMO_CODE_MAX_LENGTH
 * printable characters in any mix and any shape, an agent's ABC-123
 * included, but never three letters and two or more hyphens, which the
 * Admission form's box shortens to one. No agent code may share its key
 * (boxHyphenTwin); the database checks that.
 */
export function isPromoCode(code: string): boolean {
  return code.length >= 1 && code.length <= PROMO_CODE_MAX_LENGTH && /^[!-~]+$/.test(code) && !/^[A-Z]{3}-{2,}/.test(code)
}

/**
 * The code spelt the other way round the hyphen the Admission form's box adds
 * between three letters and a digit: ABC-123 for ABC123 and ABC123 for
 * ABC-123. Null when the code isn't that shape. The database holds the two as
 * one code, so no agent code or Promo code is the other's twin.
 */
export function boxHyphenTwin(code: string): string | null {
  if (/^[A-Z]{3}-[0-9]/.test(code)) return code.slice(0, 3) + code.slice(4)
  if (/^[A-Z]{3}[0-9]/.test(code)) return `${code.slice(0, 3)}-${code.slice(3)}`
  return null
}
