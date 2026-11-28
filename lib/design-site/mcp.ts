import "server-only"

import { PART_GROUPS } from "./catalog"
import { designSection, designSections, iconsText, partOrHelp, partsList, repoFile } from "./content"

// The design site's MCP server (prototype v6): Streamable HTTP without
// sessions or streams. Each POST carries one JSON-RPC message (or a batch)
// and gets JSON back. Read only: five tools over the design system as the
// code holds it. The route checks the password before anything here runs
// (app/design-api/mcp/route.ts).

export const SERVER_INFO = { name: "alrahmah-design", title: "Al-Rahmah Complex design system", version: "1.0.0" }
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const
const INSTRUCTIONS =
  "The approved design system of the Al-Rahmah Complex apps. Build every screen only from its parts: import them, never redraw a part, an icon or the logo. A part a screen needs that is missing is added to the kit first (get_rules: The Kit First Rule). Start with list_parts, then get_part for the code and rules of the ones you need; get_tokens for colours and type; get_icons for icon names."

type Tool = {
  name: string
  title: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, { type: "string"; description: string; enum?: readonly string[] }>; required?: string[] }
  run: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

export const TOOLS: Tool[] = [
  {
    name: "list_parts",
    title: "List the parts",
    description: "Every part of the design kit, by group: its name (id), what it is for and where its code lives.",
    inputSchema: { type: "object", properties: { group: { type: "string", description: "Only this group.", enum: PART_GROUPS } } },
    run: async (args) => ({ text: partsList(text(args.group) || undefined) }),
  },
  {
    name: "get_part",
    title: "Get one part",
    description: "One part in full: what it is for, the rules from DESIGN.md that apply to it, and its code.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "The part's id from list_parts, such as buttons or password-field." } }, required: ["name"] },
    run: async (args) => {
      const found = await partOrHelp(text(args.name))
      return { text: found.text, isError: !found.ok }
    },
  },
  {
    name: "get_tokens",
    title: "Get the tokens",
    description: "The colours, type, corners, shadows and timings as the app reads them: app/tokens.css.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const tokens = await repoFile("app/tokens.css")
      return tokens ? { text: `\`\`\`css\n${tokens.trimEnd()}\n\`\`\`` } : { text: "app/tokens.css could not be read.", isError: true }
    },
  },
  {
    name: "get_rules",
    title: "Get the design rules",
    description: "DESIGN.md, the design rules: the whole file, or one section by its heading, such as Buttons, The Kit First Rule or Do's and Don'ts.",
    inputSchema: { type: "object", properties: { section: { type: "string", description: "A heading of DESIGN.md. Leave out for the whole file." } } },
    run: async (args) => {
      const section = text(args.section)
      if (!section) {
        const doc = await repoFile("DESIGN.md")
        return doc ? { text: doc } : { text: "DESIGN.md could not be read.", isError: true }
      }
      const found = await designSection(section)
      if (found) return { text: found }
      const headings = (await designSections()).map((s) => s.heading)
      return { text: `No section is called "${section}". The sections: ${headings.join("; ")}.`, isError: true }
    },
  },
  {
    name: "get_icons",
    title: "Get the icons",
    description: "Every icon of set 1 by name with its SVG, or one icon. Use the Icon component with the name; never paste the paths into a page.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "One icon's name. Leave out for all of them." } } },
    run: async (args) => {
      const one = text(args.name)
      const answer = iconsText(one || undefined)
      return { text: answer, isError: one ? answer.startsWith("No icon") : false }
    },
  },
]

type JsonRpcId = string | number | null
type Request = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> }
type Response = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } }

const failure = (id: JsonRpcId, code: number, message: string): Response => ({ jsonrpc: "2.0", id, error: { code, message } })

function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return message.jsonrpc === "2.0" && typeof message.method === "string"
}

/** One message's answer, or null for a notification (no id) or a response from the client. */
export async function answer(message: unknown): Promise<Response | null> {
  if (!isRequest(message)) {
    // A client's response or a malformed message: a response needs no answer.
    const loose = message as Record<string, unknown> | null
    if (loose && typeof loose === "object" && ("result" in loose || "error" in loose)) return null
    return failure(null, -32600, "Invalid request: send a JSON-RPC 2.0 message.")
  }
  const id = message.id
  if (id === undefined) return null
  const params = message.params ?? {}
  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0]
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } }
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) } }
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name)
      if (!tool) return failure(id, -32602, `No tool is called "${String(params.name)}". The tools: ${TOOLS.map((t) => t.name).join(", ")}.`)
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {}
      const result = await tool.run(args)
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: result.text }], isError: Boolean(result.isError) } }
    }
    default:
      return failure(id, -32601, `No method "${message.method}". This server answers initialize, ping, tools/list and tools/call.`)
  }
}

/** The answer to a POST body: one message, or a batch; null when nothing needs an answer. */
export async function answerBody(body: unknown): Promise<Response | Response[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return failure(null, -32600, "Invalid request: an empty batch.")
    const answers = (await Promise.all(body.map(answer))).filter((a): a is Response => a !== null)
    return answers.length ? answers : null
  }
  return answer(body)
}
