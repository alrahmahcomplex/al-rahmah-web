import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  agentRecordHref,
  approveOutcome,
  createRefusal,
  familyLine,
  feeImpactLine,
  phoneTakenLine,
  recreateRefusal,
  retiredCodeLine,
  statusChangeLine,
  statusOutcome,
} from "@/app/staff/agents/outcome"
import { agentsHref, parseAgentSearch } from "@/app/staff/agents/search-params"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"
import { AGENTS_PER_PAGE, agentSearchPatterns, changeAgentStatus, createAgent, getAgentFeeImpact, recreateAgent } from "@/lib/services/marketing-agents"

describe("the Marketing Agents navigation entry", () => {
  it("shows to anyone who may view leads, and to no one else", () => {
    const agents = STAFF_NAV.find((entry) => entry.label === "Marketing Agents")
    expect(agents).toMatchObject({ href: "/staff/agents", label: "Marketing Agents", group: "Referrals", permission: "leads.view" })
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
    for (const error of ["forbidden", "not-found", "retired", "no-change", "invalid-reason", "unavailable", "uncertain", "signed-out"] as const) {
      const outcome = statusOutcome({ ok: false, error }, "switch-on", agent)
      expect(outcome.status).toBe("refused")
      expect(outcome.message).toMatch(/^[A-Z].*\.$/)
      if (error.includes("-")) expect(outcome.message).not.toContain(error)
    }
  })
})

describe("a status change whose answer is lost", () => {
  // What PostgREST returns when the request or its answer never arrives.
  const transport = { message: "TypeError: fetch failed", details: "", hint: "", code: "" }
  const agent = { fullName: "Baraka Juma", code: "BJN-402" }
  function client(error: object) {
    return { rpc: async () => ({ data: null, error, status: 0 }) } as unknown as Parameters<typeof changeAgentStatus>[0]
  }

  it("is uncertain, and tells the Manager to reload and check the agent's status", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await changeAgentStatus(client(transport), "agent", "switch-off", "Left")
    expect(result).toEqual({ ok: false, error: "uncertain" })
    const message = statusOutcome({ ok: false, error: "uncertain" }, "switch-off", agent).message
    expect(message).not.toMatch(/Nothing was changed/)
    expect(message).toMatch(/[Rr]eload the page/)
    expect(message).toMatch(/status/)
    errorLog.mockRestore()
  })

  it("is uncertain for any error it doesn't know, such as an unreadable reply from a gateway", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const error of [{ message: "<html>502 Bad Gateway</html>" }, { message: "deadlock detected", details: "", hint: "", code: "40P01" }]) {
      expect(await changeAgentStatus(client(error), "agent", "switch-off", "Left")).toEqual({ ok: false, error: "uncertain" })
    }
    errorLog.mockRestore()
  })

  it("keeps a known refusal certain", async () => {
    const refused = { message: "no_change", details: "", hint: "", code: "P0001" }
    expect(await changeAgentStatus(client(refused), "agent", "switch-off", "Left")).toEqual({ ok: false, error: "no-change" })
  })
})

describe("the fee impact of a large agent", () => {
  it("reads the whole list in one call, past the API's 1,000-row cap", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({
      lead_id: `lead-${i}`,
      admission_number: `A${i}`,
      student_name: "Pupil",
      class_name: "STD 3",
      contact_name: "Parent",
      contact_phone: "+255700000000",
      fee_now: 40000,
      fee_after: 50000,
    }))
    // The database answers one JSON array, one value however long. A second
    // call could read a different moment, so the list must come from one.
    const rpc = vi.fn(async () => ({ data: rows, error: null }))
    const client = { rpc } as unknown as Parameters<typeof getAgentFeeImpact>[0]
    const impact = await getAgentFeeImpact(client, "agent", "switch-off")
    expect(impact.ok && impact.data.families.map((family) => family.leadId)).toEqual(rows.map((row) => row.lead_id))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("agent_status_fee_impact", { agent_id: "agent", kind: "switched_off" })
  })
})

describe("creating an agent and Recreate (#189)", () => {
  const baraka = { id: "a", fullName: "Baraka Juma", code: "BJN-402", state: "Switched off" as const }
  function client(answer: { data?: unknown; error?: object | null }) {
    return { rpc: async () => ({ data: answer.data ?? null, error: answer.error ?? null }) } as unknown as Parameters<typeof createAgent>[0]
  }

  it("names whose phone, code or retired code it is", () => {
    expect(phoneTakenLine(baraka)).toBe("This number already belongs to Baraka Juma, BJN-402, Switched off")
    expect(retiredCodeLine({ fullName: "Baraka Juma" }, 3)).toBe("This code belonged to retired record Baraka Juma. 3 students carry it.")
    expect(retiredCodeLine({ fullName: "Baraka Juma" }, 1)).toBe("This code belonged to retired record Baraka Juma. 1 student carries it.")
    expect(agentRecordHref("BJN-402")).toBe("/staff/agents?status=all&q=BJN-402")
    expect(agentRecordHref("BJN-402", true)).toBe("/staff/agents?status=retired&q=BJN-402")
  })

  it("reads the database's answers", async () => {
    expect(
      await createAgent(client({ data: { outcome: "phone_taken", agent: { id: "a", full_name: "Baraka Juma", code: "BJN-402", state: "Approved" } } }), {
        fullName: "x",
        phone: "y",
      }),
    ).toEqual({ ok: true, data: { kind: "phone-taken", agent: { id: "a", fullName: "Baraka Juma", code: "BJN-402", state: "Approved" } } })
    expect(
      await createAgent(client({ data: { outcome: "retired_code", agent: { id: "a", full_name: "Baraka Juma", code: "BJN-402" }, student_count: 4 } }), {
        fullName: "x",
        phone: "y",
      }),
    ).toEqual({ ok: true, data: { kind: "retired-code", agent: { id: "a", fullName: "Baraka Juma", code: "BJN-402" }, studentCount: 4 } })
    const phoneTaken = { message: "phone_taken", details: JSON.stringify({ id: "a", full_name: "Baraka Juma", code: "BJN-402", state: "Approved" }), code: "P0001" }
    expect(await recreateAgent(client({ error: phoneTaken }), "old", { fullName: "x", phone: "y" }, "Wrong")).toEqual({
      ok: false,
      error: { kind: "phone-taken", agent: { id: "a", fullName: "Baraka Juma", code: "BJN-402", state: "Approved" } },
    })
  })

  it("treats a lost answer to a save as uncertain, and tells the Manager to check before trying again", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const lost = { message: "TypeError: fetch failed", details: "", hint: "", code: "" }
    expect(await createAgent(client({ error: lost }), { fullName: "x", phone: "y" })).toEqual({ ok: false, error: { kind: "uncertain" } })
    expect(await recreateAgent(client({ error: lost }), "old", { fullName: "x", phone: "y" }, "Wrong")).toEqual({
      ok: false,
      error: { kind: "uncertain" },
    })
    expect(createRefusal({ kind: "uncertain" }).message).toMatch(/[Rr]eload the page/)
    expect(createRefusal({ kind: "uncertain" }).message).not.toMatch(/Nothing was saved/)
    errorLog.mockRestore()
  })

  it("points an invalid field at the field", () => {
    expect(createRefusal({ kind: "invalid", field: "phone" })).toEqual({ field: "phone", message: expect.stringMatching(/mobile/) })
    expect(recreateRefusal({ kind: "invalid", field: "reason" })).toEqual({ message: expect.stringMatching(/reason/) })
  })
})
