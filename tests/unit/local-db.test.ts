import { describe, expect, it } from "vitest"

import { mergeEnv, pickSlot, projectIdFor, rewriteConfig, SLOT_COUNT } from "@/scripts/local-db.mjs"

const CONFIG = [
  'project_id = "al-rahmah-web"',
  "[api]",
  "port = 55421",
  "[db]",
  "port = 55422",
  "shadow_port = 55420",
  "# smtp_port = 55425",
  "[auth]",
  'site_url = "http://127.0.0.1:3000"',
  'additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback", "http://localhost:3000/auth/callback"]',
  "[edge_runtime]",
  "inspector_port = 8083",
].join("\n")

describe("rewriteConfig", () => {
  it("gives a slot its own project id and shifts every port by the slot's block", () => {
    const out = rewriteConfig(CONFIG, 2)
    expect(out).toContain('project_id = "al-rahmah-web-slot2"')
    expect(out).toContain("port = 55621")
    expect(out).toContain("port = 55622")
    expect(out).toContain("shadow_port = 55620")
    expect(out).toContain("inspector_port = 8283")
  })

  it("points auth redirects at the slot's dev server", () => {
    const out = rewriteConfig(CONFIG, 1)
    expect(out).toContain('site_url = "http://127.0.0.1:3001"')
    expect(out).toContain('["http://127.0.0.1:3001/auth/callback", "http://localhost:3001/auth/callback"]')
  })

  it("leaves commented settings alone", () => {
    expect(rewriteConfig(CONFIG, 3)).toContain("# smtp_port = 55425")
  })

  it("changes nothing for the main checkout's slot 0", () => {
    expect(rewriteConfig(CONFIG, 0)).toBe(CONFIG)
  })
})

describe("projectIdFor", () => {
  it("keeps the main checkout's project id", () => {
    expect(projectIdFor(0)).toBe("al-rahmah-web")
  })
})

describe("pickSlot", () => {
  const me = "D:/repo/.claude/worktrees/me"
  const other = "D:/repo/.claude/worktrees/other"

  it("takes the lowest slot when nothing is claimed", () => {
    expect(pickSlot([], me)).toBe(1)
  })

  it("keeps the slot this worktree already holds, running or not", () => {
    expect(pickSlot([{ slot: 2, worktree: me, running: false }], me)).toBe(2)
    expect(pickSlot([{ slot: 3, worktree: me, running: true }], me)).toBe(3)
  })

  it("skips slots another worktree is running", () => {
    expect(pickSlot([{ slot: 1, worktree: other, running: true }], me)).toBe(2)
  })

  it("reuses a slot whose owner left it stopped", () => {
    expect(pickSlot([{ slot: 1, worktree: other, running: false }], me)).toBe(1)
  })

  it("refuses when every slot is running for someone else", () => {
    const claims = Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, worktree: `${other}${i}`, running: true }))
    expect(pickSlot(claims, me)).toBeNull()
  })
})

describe("mergeEnv", () => {
  it("replaces known keys and keeps every other line", () => {
    const out = mergeEnv("A=1\nNEXT_PUBLIC_SUPABASE_URL=old\n", { NEXT_PUBLIC_SUPABASE_URL: "new", E2E_PORT: "3101" })
    expect(out).toBe("A=1\nNEXT_PUBLIC_SUPABASE_URL=new\nE2E_PORT=3101\n")
  })

  it("starts a file from nothing", () => {
    expect(mergeEnv("", { E2E_PORT: "3100" })).toBe("E2E_PORT=3100\n")
  })
})
