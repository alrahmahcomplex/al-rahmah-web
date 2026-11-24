// Masks an agent's email or mobile login for the "Your pages have moved"
// notice on portal.alrahmahcomplex.or.tz/auth (#539, A-N7), so the agent
// recognises which account to sign in with without printing the whole value.

export function formatTanzanianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("255") && digits.length === 12) {
    return `0${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return raw.trim() || null
}

export function maskLogin({ email, phone }: { email?: string | null; phone?: string | null }): string | null {
  if (phone) {
    const local = formatTanzanianMobile(phone)
    if (local) {
      const digits = local.replace(/\D/g, "")
      if (digits.length === 10) return `${digits.slice(0, 4)} *** ${digits.slice(7)}`
      if (digits.length >= 6) return `${digits.slice(0, 3)} *** ${digits.slice(-3)}`
    }
  }
  if (email) {
    const trimmed = email.trim()
    const at = trimmed.indexOf("@")
    if (at > 0) {
      const user = trimmed.slice(0, at)
      const domain = trimmed.slice(at + 1)
      const shown = user.length <= 2 ? user[0] : user.slice(0, 2)
      return `${shown}***@${domain}`
    }
  }
  return null
}
