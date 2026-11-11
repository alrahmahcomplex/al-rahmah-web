import { describe, expect, it } from "vitest"

// Next.js's own matcher for a rewrite's `has` and `missing` conditions, so the
// test picks a copy the way `next start` does.
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination"

import nextConfig from "@/next.config"
import {
  CACHED_PUBLIC_PATHS,
  isCachedPublicPath,
  languageOfState,
  languageStateRewrites,
  promptNeededInState,
  statePath,
} from "@/lib/language-state"

type Rewrite = ReturnType<typeof languageStateRewrites>[number]

// The first rewrite that matches a request for `path` with this Cookie header.
function copyFor(path: string, cookie: string | undefined): string | undefined {
  const request = { headers: cookie ? { cookie } : {} }
  const match = languageStateRewrites().find(
    (rewrite: Rewrite) => rewrite.source === path && matchHas(request as never, {}, rewrite.has, rewrite.missing) !== false,
  )
  return match?.destination
}

describe("picking a page's copy from the lang cookie", () => {
  it.each(CACHED_PUBLIC_PATHS)("%s: no cookie, English, any other value", (path) => {
    expect(copyFor(path, undefined)).toBe(statePath("first", path))
    expect(copyFor(path, "other=1")).toBe(statePath("first", path))
    expect(copyFor(path, "lang=en")).toBe(statePath("en", path))
    expect(copyFor(path, "lang=sw")).toBe(statePath("sw", path))
    expect(copyFor(path, "a=1; lang=en; b=2")).toBe(statePath("en", path))
  })

  it.each(["fr", "english", "en-GB", "EN", "xen"])("treats lang=%s as Swahili with no card", (value) => {
    expect(copyFor("/", `lang=${value}`)).toBe(statePath("sw", "/"))
  })

  it("maps / to the state's root copy", () => {
    expect(statePath("en", "/")).toBe("/by-language/en")
    expect(statePath("first", "/")).toBe("/by-language/first")
  })

  it("gives each state its language and card", () => {
    expect([languageOfState("first"), languageOfState("sw"), languageOfState("en")]).toEqual(["sw", "sw", "en"])
    expect([promptNeededInState("first"), promptNeededInState("sw"), promptNeededInState("en")]).toEqual([true, false, false])
  })

  it("accepts only the cached public addresses as a place to return to", () => {
    expect(isCachedPublicPath("/")).toBe(true)
    expect(isCachedPublicPath("https://example.com")).toBe(false)
    expect(isCachedPublicPath("//example.com")).toBe(false)
    expect(isCachedPublicPath("/login")).toBe(false)
    expect(isCachedPublicPath(null)).toBe(false)
  })
})

describe("next.config.ts", () => {
  it("rewrites before the filesystem, so the public address reaches the copy", async () => {
    const rewrites = await nextConfig.rewrites!()
    expect(Array.isArray(rewrites) ? null : rewrites.beforeFiles).toEqual(languageStateRewrites())
  })

  it("sends a direct visit to a copy back to the public address", async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects).toContainEqual({ source: "/by-language/:state/:path*", destination: "/:path*", permanent: false })
  })
})
