import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import nextConfig from "@/next.config"

// An invite sent from the Supabase dashboard lands on the site root. The
// redirect in next.config.ts sends it on to /auth/confirm before the home page
// renders.
function open(url: string) {
  return unstable_getResponseFromNextConfig({ url, nextConfig })
}

describe("the site root", () => {
  it("forwards an invite link to /auth/confirm, query and all", async () => {
    const response = await open("https://school.example/?token_hash=abc123&type=invite")

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe("https://school.example/auth/confirm?token_hash=abc123&type=invite")
  })

  it("serves the home page to everyone else", async () => {
    for (const url of ["https://school.example/", "https://school.example/?type=invite", "https://school.example/?token_hash=abc"]) {
      expect(getRedirectUrl(await open(url))).toBeNull()
    }
  })
})
