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

// One sign-in page (#264): old Discount code sign-in links from emails,
// bookmarks and print land on /login for good.
describe("the old Discount code sign-in addresses", () => {
  it.each([
    ["/discount-code/sign-in", "/login"],
    ["/discount-code/forgot-password", "/login/forgot-password"],
  ])("permanently forward %s to %s", async (from, to) => {
    const response = await open(`https://school.example${from}`)

    expect(response.status).toBe(308)
    expect(getRedirectUrl(response)).toBe(`https://school.example${to}`)
  })

  it("keep the pages the email links open where they are", async () => {
    for (const path of ["/discount-code/set-password?token_hash=a&type=invite", "/discount-code/reset-password?token_hash=a&type=recovery"]) {
      expect(getRedirectUrl(await open(`https://school.example${path}`))).toBeNull()
    }
  })
})
