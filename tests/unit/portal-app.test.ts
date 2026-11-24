import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { AGENTS_THEME_COLOR, agentsManifest, PORTAL_THEME_COLOR, portalManifest, PUBLIC_THEME_COLOR } from "@/lib/portal-app"
import { STAFF_PATHS } from "@/lib/site-hosts"

// Both apps (portal. and agents.) install as apps; the public site does not
// (#497, #539). Every app layout carries PORTAL_APP_METADATA and sets its own
// viewport theme colour so root viewport.themeColor doesn't override the
// manifest.
describe("app layouts and manifests", () => {
  it.each([...STAFF_PATHS.map((p) => `app${p}`), "app/discount-code", "app/by-language/[state]/auth", "app/by-language/[state]/agents-auth"])(
    "%s/layout.tsx carries the install tags and theme colour",
    (dir) => {
      const file = path.join(process.cwd(), dir, "layout.tsx")
      expect(existsSync(file), `${dir}/layout.tsx`).toBe(true)
      const source = readFileSync(file, "utf8")
      expect(source).toMatch(/\bPORTAL_APP_METADATA\b/)
      expect(source).toMatch(/\b(viewport|generateViewport)\b/)
    },
  )

  it("the root layout carries no install tags and keeps the public theme colour", () => {
    const root = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8")
    expect(root).not.toMatch(/PORTAL_APP_METADATA|manifest:|appleWebApp/)
    expect(root).toContain("PUBLIC_THEME_COLOR")
    expect(PUBLIC_THEME_COLOR).toBe("#0900bb")
  })

  it("no manifest file convention links the manifest from every page", () => {
    for (const file of ["manifest.ts", "manifest.js", "manifest.json"]) {
      expect(existsSync(path.join(process.cwd(), "app", file)), `app/${file}`).toBe(false)
    }
    expect(statSync(path.join(process.cwd(), "app/manifest.webmanifest")).isDirectory()).toBe(true)
    expect(statSync(path.join(process.cwd(), "app/agents-manifest.webmanifest")).isDirectory()).toBe(true)
  })

  it("gives portal orange (#ee7300) and agents indigo (#2408B2), both named Al-Rahmah", () => {
    const portal = portalManifest()
    const agents = agentsManifest()

    expect(PORTAL_THEME_COLOR).toBe("#ee7300")
    expect(AGENTS_THEME_COLOR).toBe("#2408B2")
    expect(portal).toMatchObject({ id: "/", short_name: "Al-Rahmah", start_url: "/auth", theme_color: "#ee7300" })
    expect(agents).toMatchObject({ id: "/", short_name: "Al-Rahmah", start_url: "/auth", theme_color: "#2408B2" })
  })

  it("ships every icon referenced by both manifests and both hosts' favicons", () => {
    for (const manifest of [portalManifest(), agentsManifest()]) {
      for (const icon of manifest.icons ?? []) {
        expect(existsSync(path.join(process.cwd(), "public", icon.src)), icon.src).toBe(true)
      }
    }
    for (const file of [
      "public/apple-touch-icon.png",
      "public/icons/favicon-32.png",
      "public/agents/favicon.ico",
      "public/agents/apple-touch-icon.png",
      "public/agents/icons/favicon-32.png",
    ]) {
      expect(existsSync(path.join(process.cwd(), file)), file).toBe(true)
    }
  })
})
