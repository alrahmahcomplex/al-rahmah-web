import { describe, expect, it } from "vitest"

import { discountCodeShareLink } from "@/lib/discount-code-share"

// Share on WhatsApp from the Discount code pages, through the shared WhatsApp
// module (#180): no number, so the sender picks the chat.
describe("Share on WhatsApp", () => {
  it("is a wa.me link with no recipient, the text encoded whole", () => {
    const link = discountCodeShareLink("Code AJM-407 + punguzo: https://x.example/apply?ref=AJM-407")
    expect(link).toBe(
      "https://wa.me/?text=Code%20AJM-407%20%2B%20punguzo%3A%20https%3A%2F%2Fx.example%2Fapply%3Fref%3DAJM-407",
    )
    expect(decodeURIComponent(new URL(link!).search.slice("?text=".length))).toBe(
      "Code AJM-407 + punguzo: https://x.example/apply?ref=AJM-407",
    )
  })

  it("is null when the text can't be sent", () => {
    expect(discountCodeShareLink("x".repeat(9000))).toBeNull()
  })
})
