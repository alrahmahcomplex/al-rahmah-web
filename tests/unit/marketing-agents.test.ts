import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { approveOutcome, familyLine, feeImpactLine, statusChangeLine, statusOutcome } from "@/app/staff/agents/outcome"
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

describe("switching an agent off and on, and retiring them", () => {
  const agent = { fullName: "Baraka Juma", code: "BJN-402" }

  it("reads the Retired filter from the URL, and never starts on it", () => {
    expect(parseAgentSearch({ status: "retired" }, true).status).toBe("Retired")
    expect(agentsHref({ status: "Retired", page: 1 })).toBe("/staff/agents?status=retired")
    expect(parseAgentSearch({}, true).status).not.toBe("Retired")
    expect(parseAgentSearch({}, false).status).not.toBe("Retired")
  })

  it("counts the families whose fee changes", () => {
    expect(feeImpactLine(0)).toBe("This changes the interview fee for 0 families not yet Paid.")
    expect(feeImpactLine(1)).toBe("This changes the interview fee for 1 family not yet Paid.")
    expect(feeImpactLine(3)).toBe("This changes the interview fee for 3 families not yet Paid.")
  })

  it("gives staff a Swahili line for each family, with the fee the change leaves", () => {
    expect(familyLine({ feeNow: 40000, feeAfter: 50000 })).toBe(
      "Code ya punguzo mliyotumia haitoi punguzo kwa sasa. Ada ya usaili sasa ni TZS 50,000 kwa kila mtoto.",
    )
    expect(familyLine({ feeNow: 50000, feeAfter: 40000 })).toBe(
      "Code ya punguzo mliyotumia inatoa punguzo tena. Ada ya usaili sasa ni TZS 40,000 kwa kila mtoto.",
    )
  })

  it("writes the retired row's line, naming the replacement once there is one", () => {
    const retiredAt = "2026-11-04T06:30:00Z"
    const note = { kind: "retired" as const, changedAt: retiredAt, changedBy: "Test Manager", replacedBy: null }
    expect(statusChangeLine({ retiredAt, switchedOffAt: null, statusChange: note })).toBe("Retired by Test Manager on 4 Nov 2026")
    expect(
      statusChangeLine({
        retiredAt,
        switchedOffAt: null,
        statusChange: { ...note, kind: "recreated", replacedBy: { fullName: "Baraka Juma Njoroge", code: "BJN-402" } },
      }),
    ).toBe("Retired by Test Manager on 4 Nov 2026, replaced by Baraka Juma Njoroge (BJN-402)")
    expect(
      statusChangeLine({ retiredAt: null, switchedOffAt: retiredAt, statusChange: { ...note, kind: "switched_off" } }),
    ).toBe("Switched off by Test Manager on 4 Nov 2026")
    expect(statusChangeLine({ retiredAt: null, switchedOffAt: null, statusChange: null })).toBeNull()
  })

  it("reports what changed, and every refusal as a sentence", () => {
    expect(statusOutcome({ ok: true, data: { feeChangeCount: 2 } }, "switch-off", agent)).toEqual({
      status: "changed",
      message: "Baraka Juma (BJN-402) is switched off. 2 families' interview fee changed.",
    })
    expect(statusOutcome({ ok: true, data: { feeChangeCount: 0 } }, "retire", agent).message).toBe(
      "Baraka Juma (BJN-402) is retired. No interview fee changed.",
    )
    for (const error of ["forbidden", "not-found", "retired", "no-change", "invalid-reason", "unavailable", "signed-out"] as const) {
      const outcome = statusOutcome({ ok: false, error }, "switch-on", agent)
      expect(outcome.status).toBe("refused")
      expect(outcome.message).toMatch(/^[A-Z].*\.$/)
      if (error.includes("-")) expect(outcome.message).not.toContain(error)
    }
  })
})
