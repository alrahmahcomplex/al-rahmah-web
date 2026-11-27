import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { KIT_CARD_IDS } from "@/app/design/_kit/kit-page"
import { findPart, PART_GROUPS, PARTS, partsIn } from "@/lib/design-site/catalog"

// The design site's one list of parts (lib/design-site/catalog.ts) feeds the
// Design system page, its sidebar sections, llms.txt and the MCP server. It
// must cover the kit, and the page must draw every part.

describe("the parts catalogue", () => {
  it("gives every part a unique id and a known group", () => {
    const ids = PARTS.map((part) => part.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const part of PARTS) expect(PART_GROUPS, part.id).toContain(part.group)
    for (const group of PART_GROUPS) expect(partsIn(group).length, group).toBeGreaterThan(0)
  })

  it("names only files that exist", () => {
    for (const part of PARTS) for (const file of part.files) expect(existsSync(join(process.cwd(), file)), `${part.id}: ${file}`).toBe(true)
  })

  it("holds every file of the kit, so a part added to the kit reaches the page, llms.txt and the MCP server", () => {
    const named = new Set(PARTS.flatMap((part) => part.files))
    const kit = readdirSync(join(process.cwd(), "components/kit")).filter((file) => /\.(tsx?|css)$/.test(file) && file !== "index.ts")
    const missing = kit.map((file) => `components/kit/${file}`).filter((file) => !named.has(file))
    expect(missing).toEqual([])
  })

  it("has a card on the Design system page for every part, and no card without a part", () => {
    expect([...KIT_CARD_IDS].sort()).toEqual(PARTS.map((part) => part.id).sort())
  })

  it("finds a part by its id or its title, in any case", () => {
    expect(findPart("buttons")?.title).toBe("Buttons")
    expect(findPart("  Password Field ")?.id).toBe("password-field")
    expect(findPart("nothing-like-this")).toBeUndefined()
  })
})
