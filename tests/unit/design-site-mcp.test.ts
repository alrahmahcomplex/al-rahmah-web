// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { answer, answerBody, TOOLS } = await import("@/lib/design-site/mcp")
const { iconsText, llmsText, svgMarkup } = await import("@/lib/design-site/content")
const { ICONS } = await import("@/components/icons/registry")

// The design site's MCP server (lib/design-site/mcp.ts) and llms.txt read the
// design system from the code itself. These run against this checkout.

const call = (name: string, args: Record<string, unknown> = {}) => answer({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } })
const textOf = (reply: Awaited<ReturnType<typeof answer>>) => (reply?.result as { content: { text: string }[] }).content[0].text

describe("the MCP server", () => {
  it("introduces itself, answering in the client's protocol version when it knows it", async () => {
    const reply = await answer({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    expect(reply?.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "alrahmah-design" } })
    const unknown = await answer({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    expect(unknown?.result).toMatchObject({ protocolVersion: "2025-06-18" })
  })

  it("lists five read-only tools", async () => {
    const reply = await answer({ jsonrpc: "2.0", id: 3, method: "tools/list" })
    const tools = (reply?.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools
    expect(tools.map((t) => t.name)).toEqual(["list_parts", "get_part", "get_tokens", "get_rules", "get_icons"])
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
    expect(TOOLS).toHaveLength(5)
  })

  it("lists the parts, all or one group", async () => {
    expect(textOf(await call("list_parts"))).toContain("- password-field: Password field.")
    const inputs = textOf(await call("list_parts", { group: "Inputs" }))
    expect(inputs).toContain("## Inputs")
    expect(inputs).not.toContain("## Actions")
  })

  it("gives one part's rules and code, and says when there is no such part", async () => {
    const reply = await call("get_part", { name: "password-field" })
    const text = textOf(reply)
    expect(text).toContain("# Password field (password-field)")
    expect(text).toContain("### components/kit/password-field.tsx")
    expect(text).toContain("export function PasswordField")
    expect(text).toContain("### Inputs")
    expect((reply?.result as { isError: boolean }).isError).toBe(false)
    const missing = await call("get_part", { name: "rocket" })
    expect((missing?.result as { isError: boolean }).isError).toBe(true)
    expect(textOf(missing)).toContain("list_parts")
  })

  it("gives the tokens and the rules, whole or one section", async () => {
    expect(textOf(await call("get_tokens"))).toContain("--gf-indigo")
    expect(textOf(await call("get_rules", { section: "Buttons" }))).toMatch(/^### Buttons/)
    expect(textOf(await call("get_rules"))).toContain("The Kit First Rule")
    const none = await call("get_rules", { section: "No such heading" })
    expect((none?.result as { isError: boolean }).isError).toBe(true)
  })

  it("gives the icons as SVG, the detail in its own layer", async () => {
    const eye = textOf(await call("get_icons", { name: "eye" }))
    expect(eye).toContain('<g class="gf-ic-detail"><circle cx="12" cy="12" r="3"></circle></g>')
    expect(iconsText()).toContain("- eye-off:")
    expect(svgMarkup(ICONS.smscode.detail)).toContain('stroke-width="0.75"')
  })

  it("answers nothing to a notification, an error to an unknown method or tool", async () => {
    expect(await answer({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull()
    expect((await answer({ jsonrpc: "2.0", id: 4, method: "resources/list" }))?.error?.code).toBe(-32601)
    expect((await call("delete_everything"))?.error?.code).toBe(-32602)
    expect((await answer({ hello: "world" }))?.error?.code).toBe(-32600)
  })

  it("answers a batch, leaving out its notifications", async () => {
    const replies = await answerBody([
      { jsonrpc: "2.0", id: 5, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ])
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 5, result: {} }])
    expect(await answerBody([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull()
  })
})

describe("llms.txt", () => {
  it("holds the parts, DESIGN.md and the tokens, and says how to ask for one part", async () => {
    const text = await llmsText("https://design.alrahmahcomplex.or.tz")
    expect(text).toContain("# Al-Rahmah Complex design system")
    expect(text).toContain("- shell: Shell: frame, top bar and sidebar.")
    expect(text).toContain("The Kit First Rule")
    expect(text).toContain("--gf-orange")
    expect(text).toContain("https://design.alrahmahcomplex.or.tz/llms.txt?key=<the same password>&part=<part id>")
  })
})
