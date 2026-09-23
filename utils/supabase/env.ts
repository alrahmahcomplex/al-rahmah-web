// The public Supabase connection details, read in one place so a missing
// value fails with a useful message instead of a null-assertion crash deep
// inside the SDK.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. Copy .env.example to .env.local and fill them in from `npm run db:start`.",
    )
  }
  return { url, publishableKey }
}
