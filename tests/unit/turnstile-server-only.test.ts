import { describe, expect, it } from "vitest"

// No mock of `server-only` here: importing the module outside a server bundle
// must throw, which is what keeps TURNSTILE_SECRET_KEY out of client code.
describe("the Turnstile module", () => {
  it("refuses to load outside the server", async () => {
    await expect(import("@/lib/turnstile")).rejects.toThrow(/cannot be imported from a Client Component/)
  })
})
