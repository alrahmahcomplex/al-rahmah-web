"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import { Bento, Card, CodeBlock, CodeChip, ListRow, Note, TabSwitch } from "@/components/kit"
import { DESIGN_ORIGIN } from "@/lib/site-hosts"

import "../_kit/kit-page.css"
import { designKeyForThisBrowser } from "../actions"

// The cards of Connect an AI. The addresses are design.'s own on the live
// site and this server's elsewhere. The page shows the password as dots; the
// copy buttons put the real one in what they copy, fetched once the page is
// live and only for a browser that already gave it.

const DOTS = "••••••••"
const noSubscribe = () => () => {}

/**
 * Where llms.txt and the MCP server answer: design.'s own short addresses on
 * the live site; this server's /design-api/ ones on localhost and Previews,
 * which have no such short addresses.
 */
function useAddresses() {
  const origin = useSyncExternalStore(
    noSubscribe,
    () => (window.location.hostname === "design.alrahmahcomplex.or.tz" ? DESIGN_ORIGIN : window.location.origin),
    () => DESIGN_ORIGIN,
  )
  return origin === DESIGN_ORIGIN
    ? { llms: `${DESIGN_ORIGIN}/llms.txt`, mcp: `${DESIGN_ORIGIN}/mcp` }
    : { llms: `${origin}/design-api/llms`, mcp: `${origin}/design-api/mcp` }
}

/** The password inside single quotes for a shell, whatever characters it holds. */
const shellQuoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`
/** The password inside a TOML basic string. */
const tomlEscaped = (text: string) => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')

/** Each agent's setup with this password: the real one to copy, or dots to show. */
function setups(mcp: string, secret: string) {
  return {
    claude: `claude mcp add --transport http alrahmah-design \\\n  ${mcp} \\\n  --header ${shellQuoted(`Authorization: Bearer ${secret}`)}`,
    codex: `[mcp_servers.alrahmah-design]\nurl = "${mcp}"\nhttp_headers = { Authorization = "Bearer ${tomlEscaped(secret)}" }`,
    other: JSON.stringify({ "alrahmah-design": { url: mcp, headers: { Authorization: `Bearer ${secret}` } } }, null, 2),
  }
}

const TOOLS = [
  { name: "list_parts", what: "every part in the kit", detail: "Name, group, one line on what it is for, and where its code lives.", icon: "filter" },
  { name: "get_part", what: "one part in full", detail: "Its code, and the rules from DESIGN.md that apply to it.", icon: "search" },
  { name: "get_tokens", what: "colours, type, corners, shadows", detail: "The values in app/tokens.css, as the app reads them.", icon: "tag" },
  { name: "get_rules", what: "the design rules", detail: "DESIGN.md, whole or one section or named rule: the Kit First Rule, the One Invitation Rule, Do’s and Don’ts.", icon: "audit" },
  { name: "get_icons", what: "icons", detail: "Every icon by name with its SVG. For the illustrations, ask get_part for illustrations.", icon: "pen" },
] as const

// A code block shows the real setup and selects it when the clipboard is refused; a code chip cannot.
const COPY_BLOCK = { copiedMessage: "Copied", copyFailedMessage: "Couldn’t copy. The text is selected: press Ctrl+C." }
const COPY_CHIP = { copiedMessage: "Copied", copyFailedMessage: "Couldn’t copy. Press the copy button again." }

export function ConnectCards() {
  const { llms, mcp } = useAddresses()
  const [key, setKey] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    designKeyForThisBrowser().then(
      (found) => live && setKey(found),
      () => {},
    )
    return () => {
      live = false
    }
  }, [])

  // Until the password arrives, the page shows dots and holds no copy buttons.
  const shown = setups(mcp, DOTS)
  const real = key ? setups(mcp, key) : null

  return (
    <Bento columns={2} className="kp-ds">
      <Card id="link" title="Any AI that can open a link" caption="ChatGPT, Claude, Gemini: paste this link into the chat.">
        <div className="kp-rowx">
          <CodeChip
            code={`${llms.replace(/^https?:\/\//, "")}?key=${DOTS}`}
            prefix="The link"
            copyValue={key ? `${llms}?key=${encodeURIComponent(key)}` : null}
            copyLabel="Copy link"
            {...COPY_CHIP}
          />
        </div>
        <Note icon="info">The link holds the password. Anyone you send it to can read the design system.</Note>
      </Card>

      <Card id="mcp" title="Agents that use MCP" caption="Claude Code, Codex, Cursor and other coding agents.">
        <div className="kp-rowx">
          <CodeChip code={mcp} prefix="The MCP address" copyValue={mcp} copyLabel="Copy address" {...COPY_CHIP} />
        </div>
        <TabSwitch
          label="Agent"
          tabs={[
            { value: "claude", label: "Claude Code", panel: <CodeBlock copyValue={real?.claude ?? null} copyLabel="Copy command" {...COPY_BLOCK}>{shown.claude}</CodeBlock> },
            { value: "codex", label: "Codex", panel: <CodeBlock label="~/.codex/config.toml" copyValue={real?.codex ?? null} copyLabel="Copy settings" {...COPY_BLOCK}>{shown.codex}</CodeBlock> },
            { value: "other", label: "Other", panel: <CodeBlock copyValue={real?.other ?? null} copyLabel="Copy settings" {...COPY_BLOCK}>{shown.other}</CodeBlock> },
          ]}
        />
      </Card>

      <Card id="tools" title="What an AI can ask for" caption="Read only. Nothing an AI does here changes the app or touches family records." data-bento="full">
        {TOOLS.map((tool) => (
          <ListRow key={tool.name} icon={tool.icon} title={`${tool.name} · ${tool.what}`} caption={tool.detail} />
        ))}
      </Card>
    </Bento>
  )
}
