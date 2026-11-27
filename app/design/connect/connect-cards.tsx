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

/** design.'s address on the live site; this server's own on localhost and Previews. */
function useSiteOrigin() {
  return useSyncExternalStore(
    noSubscribe,
    () => (window.location.hostname === "design.alrahmahcomplex.or.tz" ? DESIGN_ORIGIN : window.location.origin),
    () => DESIGN_ORIGIN,
  )
}

const TOOLS = [
  { name: "list_parts", what: "every part in the kit", detail: "Name, group, one line on what it is for, and where its code lives.", icon: "filter" },
  { name: "get_part", what: "one part in full", detail: "Its code, and the rules from DESIGN.md that apply to it.", icon: "search" },
  { name: "get_tokens", what: "colours, type, corners, shadows", detail: "The values in app/tokens.css, as the app reads them.", icon: "tag" },
  { name: "get_rules", what: "the design rules", detail: "DESIGN.md, whole or one section: the Kit First Rule, the One Invitation Rule, Do’s and Don’ts.", icon: "audit" },
  { name: "get_icons", what: "icons and illustrations", detail: "Every icon by name with its SVG, and the illustrations.", icon: "pen" },
] as const

const COPY = { copiedMessage: "Copied", copyFailedMessage: "Couldn’t copy. The text is selected: press Ctrl+C." }

export function ConnectCards() {
  const origin = useSiteOrigin()
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
  const secret = key ?? DOTS
  const ready = (text: string) => (key ? text : null)
  const host = origin.replace(/^https?:\/\//, "")
  const mcp = `${origin}/mcp`
  const claude = `claude mcp add --transport http alrahmah-design ${mcp} --header "Authorization: Bearer ${secret}"`
  const codex = `[mcp_servers.alrahmah-design]\nurl = "${mcp}"\nhttp_headers = { Authorization = "Bearer ${secret}" }`
  const other = JSON.stringify({ "alrahmah-design": { url: mcp, headers: { Authorization: `Bearer ${secret}` } } }, null, 2)
  const mask = (text: string) => text.replaceAll(secret, DOTS)

  return (
    <Bento columns={2} className="kp-ds">
      <Card id="link" title="Any AI that can open a link" caption="ChatGPT, Claude, Gemini: paste this link into the chat.">
        <div className="kp-rowx">
          <CodeChip
            code={`${host}/llms.txt?key=${DOTS}`}
            prefix="The link"
            copyValue={ready(`${origin}/llms.txt?key=${encodeURIComponent(secret)}`)}
            copyLabel="Copy link"
            {...COPY}
          />
        </div>
        <Note icon="info">The link holds the password. Anyone you send it to can read the design system.</Note>
      </Card>

      <Card id="mcp" title="Agents that use MCP" caption="Claude Code, Codex, Cursor and other coding agents.">
        <div className="kp-rowx">
          <CodeChip code={mcp} prefix="The MCP address" copyValue={mcp} copyLabel="Copy address" {...COPY} />
        </div>
        <TabSwitch
          label="Agent"
          tabs={[
            { value: "claude", label: "Claude Code", panel: <CodeBlock copyValue={ready(claude)} copyLabel="Copy command" {...COPY}>{mask(claude.replace(` ${mcp} `, ` \\\n  ${mcp} \\\n  `))}</CodeBlock> },
            { value: "codex", label: "Codex", panel: <CodeBlock label="~/.codex/config.toml" copyValue={ready(codex)} copyLabel="Copy settings" {...COPY}>{mask(codex)}</CodeBlock> },
            { value: "other", label: "Other", panel: <CodeBlock copyValue={ready(other)} copyLabel="Copy settings" {...COPY}>{mask(other)}</CodeBlock> },
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
