// The public Supabase connection details, read in one place so a missing
// value fails with a useful message instead of a null-assertion crash deep
// inside the SDK.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local and fill them in from `npm run db:start`.",
    )
  }
  return { url, anonKey }
}
