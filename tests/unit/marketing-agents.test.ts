import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { approveOutcome } from "@/app/staff/agents/outcome"
import { agentsHref, parseAgentSearch } from "@/app/staff/agents/search-params"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"
import { AGENTS_PER_PAGE, agentSearchPatterns } from "@/lib/services/marketing-agents"

describe("the Marketing Agents navigation entry", () => {
  it("shows to anyone who may view leads, and to no one else", () => {
    const agents = STAFF_NAV.find((entry) => entry.label === "Marketing Agents")
    expect(agents).toEqual({ href: "/staff/agents", label: "Marketing Agents", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(agents)
    expect(navFor(["agents.approve"])).not.toContain(agents)
    expect(navFor(["payments.view"])).not.toContain(agents)
  })
})

describe("the screen's URL", () => {
  it("starts approvers on Pending and everyone else on All", () => {
    expect(parseAgentSearch({}, true)).toEqual({ status: "Pending", query: undefined, page: 1 })
    expect(parseAgentSearch({}, false)).toEqual({ status: "all", query: undefined, page: 1 })
  })

  it("reads the status, the search and the page, and ignores what it doesn't know", () => {
    expect(parseAgentSearch({ status: "approved", q: "  amina ", page: "3" }, false)).toEqual({
      status: "Approved",
      query: "amina",
      page: 3,
    })
    expect(parseAgentSearch({ status: "all" }, true).status).toBe("all")
    expect(parseAgentSearch({ status: "rejected", page: "-1" }, true)).toEqual({ status: "Pending", query: undefined, page: 1 })
    expect(parseAgentSearch({ page: "1.5" }, true).page).toBe(1)
    expect(parseAgentSearch({ page: "99999999" }, true).page).toBe(1)
  })

  it("writes the status always, and the search and page when set", () => {
    const search = { status: "Pending" as const, query: "ZNM 401", page: 2 }
    expect(agentsHref(search)).toBe("/staff/agents?status=pending&q=ZNM+401&page=2")
    expect(agentsHref(search, { status: "all", page: 1, query: undefined })).toBe("/staff/agents?status=all")
    expect(parseAgentSearch(Object.fromEntries(new URLSearchParams(agentsHref(search).split("?")[1])), false)).toEqual(search)
  })
})

describe("agent search", () => {
  it("shows 50 agents a page", () => {
    expect(AGENTS_PER_PAGE).toBe(50)
  })

  it("matches the text lowercased, with filter characters dropped", () => {
    expect(agentSearchPatterns("  Zawadi   NEEMA ")).toEqual(["zawadi neema"])
    expect(agentSearchPatterns("ZNM-401")).toEqual(["znm-401"])
    // A code typed with spaces matches as the code normalizer reads it.
    expect(agentSearchPatterns("ZNM -401")).toEqual(["znm -401", "znm-401"])
    expect(agentSearchPatterns(" znm - 401 ")).toEqual(["znm - 401", "znm-401"])
    expect(agentSearchPatterns('a,b"c*(d)%')).toEqual(["a b c d"])
    expect(agentSearchPatterns(" ,*() ")).toEqual([])
  })

  it("also matches a phone however it is typed, by its digits without a leading zero", () => {
    expect(agentSearchPatterns("0700 000 401")).toEqual(["0700 000 401", "700000401"])
    expect(agentSearchPatterns("+255 700-000-401")).toEqual(["+255 700-000-401", "255700000401"])
    expect(agentSearchPatterns("401")).toEqual(["401"])
    expect(agentSearchPatterns("12")).toEqual(["12"])
  })
})

describe("what the Approve dialog is told", () => {
  const agent = { fullName: "Zawadi Neema Mwakasege", code: "ZNM-401" }

  it("names the agent and code once approved", () => {
    expect(approveOutcome({ ok: true }, agent)).toEqual({
      status: "approved",
      message: "Zawadi Neema Mwakasege (ZNM-401) is Approved.",
    })
  })

  it("says why an approval was refused", () => {
    expect(approveOutcome({ ok: false, error: "no-change" }, agent).message).toMatch(/already Approved/)
    expect(approveOutcome({ ok: false, error: "forbidden" }, agent).message).toMatch(/permission/)
    expect(approveOutcome({ ok: false, error: "unavailable" }, agent).message).toMatch(/Try again/)
    expect(approveOutcome({ ok: false, error: "signed-out" }, agent).message).toMatch(/Sign in again/)
  })
})
