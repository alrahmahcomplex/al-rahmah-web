import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    set: jar.set,
  }),
}))

import { setLanguage } from "@/app/actions/language"
import { getLanguage, LANGUAGE_COOKIE } from "@/lib/language"

beforeEach(() => {
  jar.values.clear()
  jar.set.mockReset()
})

function choose(lang: string) {
  const formData = new FormData()
  formData.set("lang", lang)
  return formData
}

describe("getLanguage", () => {
  it("names the cookie lang", () => {
    expect(LANGUAGE_COOKIE).toBe("lang")
  })

  it("is Swahili when the visitor has not chosen", async () => {
    expect(await getLanguage()).toBe("sw")
  })

  it.each(["sw", "en"] as const)("reads the chosen language %s from the cookie", async (lang) => {
    jar.values.set("lang", lang)
    expect(await getLanguage()).toBe(lang)
  })

  it("falls back to Swahili for a cookie value it does not know", async () => {
    jar.values.set("lang", "fr")
    expect(await getLanguage()).toBe("sw")
  })
})

describe("setLanguage", () => {
  it("stores the choice for the whole site for a year", async () => {
    await setLanguage(choose("en"))

    expect(jar.set).toHaveBeenCalledWith("lang", "en", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    })
  })

  it("ignores a language the site does not offer", async () => {
    await setLanguage(choose("fr"))

    expect(jar.set).not.toHaveBeenCalled()
  })
})
