import { describe, expect, test } from "vitest"

import { closedState } from "@/app/staff/leads/[id]/closed-state"

describe("the closed-lead banner names the lead's state", () => {
  test.each([
    [{ status: "Declined", closure: null }, "Declined"],
    [{ status: "Visited", closure: "Inactive" }, "Inactive"],
    [{ status: "Applied", closure: "Archived" }, "Archived"],
    [{ status: "Declined", closure: "Archived" }, "Declined and Archived"],
  ] as const)("%o is %s", (lead, state) => {
    expect(closedState(lead)).toBe(state)
  })
})
