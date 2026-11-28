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

// signIn: where the email tells the holder to sign in later: the one
// sign-in page (#264, #265), at /auth since #497.
const TEMPLATES = [
  { name: "invite", path: "supabase/templates/invite.html", signIn: "/auth" },
  { name: "recovery", path: "supabase/templates/recovery.html", signIn: "/auth" },
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

describe.each(TEMPLATES)("the $name template", ({ name, path, signIn }) => {
  const html = read(path)

  it("carries a version marker on its second line", () => {
    expect(html.split("\n")[1]).toMatch(new RegExp(`^<!-- al-rahmah-template: ${name} v8 \\(\\d{4}-\\d{2}-\\d{2}, #\\d+\\)`))
  })

  // A fixed height let a wrapped label spill out of the button on a phone.
  it("lets the button grow when its label wraps", () => {
    const button = /<a class="cta"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ""
    expect(button).toContain("padding:10px 20px;")
    expect(button).not.toMatch(/(^|[;\s])height:/)
    expect(button).not.toMatch(/line-height:44px/)
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

  it("is Swahili first, with English, and states the sign-in address from .RedirectTo's host", () => {
    const agent = agentBranches(html)
    expect(agent.indexOf("nenosiri")).toBeLessThan(agent.indexOf("password"))
    expect(html).toContain(`{{ $signInOrigin := .SiteURL }}`)
    expect(html).toContain(`{{ if ge (len .RedirectTo) 37 }}`)
    expect(html).toContain(`"https://agents.alrahmahcomplex.or.tz/"`)
    expect(html).toContain(`"https://portal.alrahmahcomplex.or.tz/"`)
    expect(agent).toContain(`{{ $signInOrigin }}${signIn}"`)
    expect(html).not.toContain(`{{ .SiteURL }}${signIn}`)
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

  // #265: one recovery template for the project, so staff and agent resets
  // both land on the shared reset page, which spends the token only when the
  // new password is saved.
  it("every reset, staff's and agents', carries a token_hash back to the address it was sent with", () => {
    const html = read("supabase/templates/recovery.html")
    expect(html).toContain(`{{ $link := printf "%s?token_hash=%s&type=recovery" .RedirectTo .TokenHash }}`)
    expect(html).not.toContain(".ConfirmationURL")
    expect(html.match(/href="\{\{ \$link \}\}"/g)).toHaveLength(2)
  })

  it.each(["/discount-code/set-password", "/auth/reset-password", "/discount-code/reset-password"])(
    "%s is an allowed redirect locally",
    (path) => {
      expect(config).toContain(`"http://localhost:3100${path}"`)
      expect(config).toContain(`"http://localhost:3000${path}"`)
    },
  )

  it("the database's invite lifetime matches the link expiry", () => {
    const migration = read("supabase/migrations/20261124120600_agent_invites.sql")
    expect(migration).toMatch(/create function public\.invite_link_lifetime\(\)[\s\S]*?select interval '24 hours';/)
  })
})
