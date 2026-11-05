import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// The invite and recovery templates in supabase/templates are the source of
// truth for the hosted project (#191). These checks keep them pasteable and
// true: a version marker to compare with hosted, staff wording as the
// default, a Discount code branch that never names agents, and the expiry
// the project actually uses.

const root = join(__dirname, "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const config = read("supabase/config.toml")

const TEMPLATES = [
  { name: "invite", path: "supabase/templates/invite.html" },
  { name: "recovery", path: "supabase/templates/recovery.html" },
] as const

// The branch between `{{ if $agent }}` and its `{{ else }}`, every time.
function agentBranches(html: string): string {
  return [...html.matchAll(/\{\{ if \$agent \}\}([\s\S]*?)\{\{ else \}\}/g)].map((match) => match[1]).join("\n")
}

function staffBranches(html: string): string {
  return [...html.matchAll(/\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/g)].map((match) => match[1]).join("\n")
}

function words(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\{\{[^}]*\}\}/g, " ")
}

describe.each(TEMPLATES)("the $name template", ({ name, path }) => {
  const html = read(path)

  it("carries a version marker on its second line", () => {
    expect(html.split("\n")[1]).toMatch(new RegExp(`^<!-- al-rahmah-template: ${name} v\\d+ \\(\\d{4}-\\d{2}-\\d{2}, #\\d+\\)`))
  })

  it("is configured locally from this file", () => {
    expect(config).toContain(`[auth.email.template.${name}]`)
    expect(config).toContain(`content_path = "./${path}"`)
  })

  it("picks the Discount code wording only from kind agent, so staff wording is the default", () => {
    expect(html).toContain(`{{ $agent := eq (printf "%v" .Data.kind) "agent" }}`)
    expect(staffBranches(html)).not.toMatch(/Punguzo/)
  })

  it("never names agents, referrals or Wakala in the Discount code wording", () => {
    expect(words(agentBranches(html))).not.toMatch(/\b(agent|agents|referral|referrals|wakala)\b/i)
  })

  it("is Swahili first, with English, and states the sign-in address", () => {
    const agent = agentBranches(html)
    expect(agent.indexOf("nenosiri")).toBeLessThan(agent.indexOf("password"))
    expect(agent).toContain("{{ .SiteURL }}/discount-code/sign-in")
  })

  it("states the link lifetime the project uses, in both languages", () => {
    // otp_expiry is in seconds; the hosted Email OTP expiration matches it
    // (docs/agents/hosted-services.md).
    const seconds = Number(/^otp_expiry = (\d+)$/m.exec(config)?.[1])
    const hours = seconds / 3600
    expect(hours).toBe(24)
    const agent = agentBranches(html)
    expect(agent).toContain(`saa ${hours}`)
    expect(agent).toContain(`${hours} hours`)
    expect(staffBranches(html)).toContain(`${hours} hours`)
  })
})

describe("the links", () => {
  it("an invite carries a token_hash back to the address it was sent with", () => {
    const html = read("supabase/templates/invite.html")
    expect(html.match(/href="\{\{ \.RedirectTo \}\}\?token_hash=\{\{ \.TokenHash \}\}&amp;type=invite"/g)).toHaveLength(2)
  })

  it("a Discount code reset carries a token_hash; a staff reset keeps the confirmation link", () => {
    const html = read("supabase/templates/recovery.html")
    expect(html).toContain(
      `{{ $link := .ConfirmationURL }}{{ if $agent }}{{ $link = printf "%s?token_hash=%s&type=recovery" .RedirectTo .TokenHash }}{{ end }}`,
    )
    expect(html.match(/href="\{\{ \$link \}\}"/g)).toHaveLength(2)
  })

  it("the Discount code set-password page is an allowed redirect locally", () => {
    expect(config).toContain(`"http://localhost:3100/discount-code/set-password"`)
    expect(config).toContain(`"http://localhost:3000/discount-code/set-password"`)
  })

  it("the database's invite lifetime matches the link expiry", () => {
    const migration = read("supabase/migrations/20261123120600_agent_invites.sql")
    expect(migration).toMatch(/create function public\.invite_link_lifetime\(\)[\s\S]*?select interval '24 hours';/)
  })
})
