import { createClient } from "@supabase/supabase-js"
import { expect, test } from "@playwright/test"

import { FORMER_STAFF, STAFF } from "./fixtures"

// Talks to local Supabase directly with the public anon key, the same access
// any visitor's browser has, to prove what row-level security allows.
function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })
}

test.describe("allowed_admin_emails row-level security", () => {
  test("anonymous visitors cannot read the allowlist", async () => {
    const { data, error } = await anonClient().from("allowed_admin_emails").select("email")

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  test("anonymous visitors cannot add to the allowlist", async () => {
    const { error } = await anonClient()
      .from("allowed_admin_emails")
      .insert({ email: "intruder@example.test" })

    expect(error?.code).toBe("42501") // insufficient_privilege: blocked by RLS
  })

  test("a signed-in user who left the allowlist cannot read it", async () => {
    const supabase = anonClient()
    await supabase.auth.signInWithPassword(FORMER_STAFF)

    const { data } = await supabase.from("allowed_admin_emails").select("email")

    expect(data).toEqual([])
  })

  test("allowlisted staff can read the allowlist", async () => {
    const supabase = anonClient()
    await supabase.auth.signInWithPassword(STAFF)

    const { data } = await supabase.from("allowed_admin_emails").select("email")

    expect(data).toEqual([{ email: STAFF.email }])
  })

  test("sign-up is refused for an email missing from the allowlist", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: "stranger@example.test",
      password: "fixture-password",
    })

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})
