import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ set: vi.fn() }))

vi.mock("next/headers", () => ({ cookies: async () => ({ set: jar.set }) }))

import { POST } from "@/app/api/language/route"

beforeEach(() => jar.set.mockReset())

function post(lang: string | null) {
  const body = new FormData()
  if (lang !== null) body.set("lang", lang)
  return POST(new Request("http://localhost/api/language", { method: "POST", body }))
}

// The in-place switch on the cached pages sets the same cookie as setLanguage.
describe("POST /api/language", () => {
  it.each(["sw", "en"])("stores %s for the whole site for a year, HttpOnly", async (lang) => {
    const response = await post(lang)

    expect(response.status).toBe(204)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(jar.set).toHaveBeenCalledWith("lang", lang, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    })
  })

  it.each(["fr", "", null])("refuses %s and sets nothing", async (lang) => {
    expect((await post(lang)).status).toBe(400)
    expect(jar.set).not.toHaveBeenCalled()
  })
})
