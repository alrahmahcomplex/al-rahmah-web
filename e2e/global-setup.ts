// Fails fast with a useful message when local Supabase is not running,
// instead of letting every test time out on the sign-in form.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in .env.local. " +
        "Run `npm run db:start` and copy API_URL and PUBLISHABLE_KEY from its output.",
    )
  }

  try {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } })
    if (!response.ok) throw new Error(`status ${response.status}`)
  } catch (error) {
    throw new Error(`Local Supabase is not answering at ${url} (${error}). Run \`npm run db:start\`.`)
  }
}
