import { beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => ({ headers: new Headers() }))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => request.headers }))

import { agentSetPasswordUrl, staffLinkOrigin } from "@/app/staff/agents/invite-link"

// Staff invites, Resend invite, Send reset link and agent invites (#497, #539).
describe("where staff screens' emails link back to", () => {
  beforeEach(() => {
    request.headers = new Headers()
  })

  it.each([
    "https://alrahmahcomplex.or.tz",
    "https://portal.alrahmahcomplex.or.tz",
    "https://agents.alrahmahcomplex.or.tz",
  ])("sends staff links to portal and agent links to agents when the request is on %s", async (origin) => {
    request.headers = new Headers({ origin, host: new URL(origin).host })

    expect(await staffLinkOrigin()).toBe("https://portal.alrahmahcomplex.or.tz")
    expect(await agentSetPasswordUrl()).toBe("https://agents.alrahmahcomplex.or.tz/discount-code/set-password")
  })

  it("resolves production hosts when the request has no Origin header", async () => {
    request.headers = new Headers({ "x-forwarded-host": "alrahmahcomplex.or.tz", "x-forwarded-proto": "https" })

    expect(await staffLinkOrigin()).toBe("https://portal.alrahmahcomplex.or.tz")
    expect(await agentSetPasswordUrl()).toBe("https://agents.alrahmahcomplex.or.tz/discount-code/set-password")
  })

  it("stays on a Preview or localhost", async () => {
    request.headers = new Headers({ origin: "https://al-rahmah-web-git-x-team.vercel.app" })
    expect(await agentSetPasswordUrl()).toBe("https://al-rahmah-web-git-x-team.vercel.app/discount-code/set-password")

    request.headers = new Headers({ host: "localhost:3100", "x-forwarded-proto": "http" })
    expect(await staffLinkOrigin()).toBe("http://localhost:3100")
  })
})
