// Tanzanian mobile numbers, as agents type them to sign in or confirm (#503).
// Accepted: 07… and 06… (10 digits), 2557… and 2556… (12 digits), and the same
// with a leading +. Spaces, dots, hyphens and brackets are ignored. The result
// is stored as normalize_phone stores it in the database: +255 and nine digits.
// Anything else, a landline or a foreign number included, is no mobile.
export function normalizeTanzanianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s.()[\]-]/g, "")
  const match = /^(?:0|\+?255)([67]\d{8})$/.exec(digits)
  return match ? `+255${match[1]}` : null
}

// What someone typed in "Email or mobile number" (#503): an email when it has
// an @, otherwise a Tanzanian mobile. Anything else is neither, and nothing
// is sent anywhere for it.
export type SignInLogin = { email: string } | { phone: string }

export function readSignInLogin(raw: string): SignInLogin | null {
  const typed = raw.trim()
  if (typed.includes("@")) {
    const email = typed.toLowerCase()
    return /^[^@\s]+@[^@\s]+$/.test(email) && email.length <= 254 ? { email } : null
  }
  const phone = normalizeTanzanianMobile(typed)
  return phone ? { phone } : null
}

// Supabase Auth and Beem write a phone without the +: 255 and nine digits.
export function withoutPlus(mobile: string): string {
  return mobile.startsWith("+") ? mobile.slice(1) : mobile
}
