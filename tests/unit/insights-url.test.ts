import { describe, expect, it } from "vitest"

import { insightsUrl } from "@/lib/insights-url"

describe("the address sent to Vercel Web Analytics and Speed Insights", () => {
  it("drops the query string, which holds link tokens, Discount codes and searched names", () => {
    expect(insightsUrl("https://example.test/login/reset-password?token_hash=abc123&type=recovery")).toBe(
      "https://example.test/login/reset-password",
    )
    expect(insightsUrl("https://example.test/apply?code=BJN-402")).toBe("https://example.test/apply")
    expect(insightsUrl("https://example.test/staff/applicants?q=Zainabu+Rejea&status=Enrolled")).toBe(
      "https://example.test/staff/applicants",
    )
  })

  it("drops the fragment", () => {
    expect(insightsUrl("https://example.test/auth/confirm#access_token=abc")).toBe("https://example.test/auth/confirm")
  })

  it("masks record ids in the path, in either case", () => {
    expect(insightsUrl("https://example.test/staff/applicants/1ead0000-0000-4000-8000-000000000070/history?tab=follow-ups#lead-follow-ups")).toBe(
      "https://example.test/staff/applicants/[id]/history",
    )
    expect(insightsUrl("/staff/re-applications/1EAD0000-0000-4000-8000-00000000007A")).toBe("/staff/re-applications/[id]")
  })

  it("leaves a plain address as it is", () => {
    expect(insightsUrl("https://example.test/staff/fees/2027")).toBe("https://example.test/staff/fees/2027")
  })
})
