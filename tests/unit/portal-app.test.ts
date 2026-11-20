import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { PORTAL_PATHS } from "@/lib/site-hosts"

// Only the portal installs as an app (#497): the top layout of every portal
// path carries the install tags (lib/portal-app.ts). A portal path added
// without them would leave its pages uninstallable; e2e/install-portal-only
// checks the HTML the pages send.
describe("portal layouts", () => {
  it.each([...PORTAL_PATHS.map((p) => `app${p}`), "app/by-language/[state]/login"])("%s/layout.tsx carries the install tags", (dir) => {
    const file = path.join(process.cwd(), dir, "layout.tsx")
    expect(existsSync(file), `${dir}/layout.tsx`).toBe(true)
    expect(readFileSync(file, "utf8")).toMatch(/\bPORTAL_APP_METADATA\b/)
  })

  it("the root layout carries none", () => {
    const root = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8")
    expect(root).not.toMatch(/PORTAL_APP_METADATA|manifest:|appleWebApp/)
  })

  it("no manifest file convention links the manifest from every page", () => {
    for (const file of ["manifest.ts", "manifest.js", "manifest.json"]) {
      expect(existsSync(path.join(process.cwd(), "app", file)), `app/${file}`).toBe(false)
    }
    // app/manifest.webmanifest is the route handler's folder, not the file convention.
    expect(statSync(path.join(process.cwd(), "app/manifest.webmanifest")).isDirectory()).toBe(true)
  })
})
