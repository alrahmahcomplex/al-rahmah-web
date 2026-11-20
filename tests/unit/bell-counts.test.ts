import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const services = vi.hoisted(() => ({
  countPendingDiscountRequests: vi.fn(),
  listPendingDiscountRequests: vi.fn(),
  countPendingReopeningRequests: vi.fn(),
  listPendingSiblingRequests: vi.fn(),
}))

vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/services/discounts", () => ({
  countPendingDiscountRequests: services.countPendingDiscountRequests,
  listPendingDiscountRequests: services.listPendingDiscountRequests,
}))
vi.mock("@/lib/services/reopening-requests", () => ({ countPendingReopeningRequests: services.countPendingReopeningRequests }))
vi.mock("@/lib/services/sibling-requests", () => ({ listPendingSiblingRequests: services.listPendingSiblingRequests }))

import { BELL_SCREENS } from "@/app/staff/bell-screens"
import { bellPending, requestCounts } from "@/app/staff/nav-counts"

// The bell's number (#322): Pending discount requests (Sibling ones too,
// #310) and Pending reopening requests. Since the old shell went (#332) the
// layout reads only these two counts.
const MANAGER = { permissions: ["leads.view", "discounts.approve", "reopenings.approve"] as never[] }

beforeEach(() => {
  vi.clearAllMocks()
  services.countPendingDiscountRequests.mockResolvedValue({ ok: true, data: 2 })
  services.listPendingSiblingRequests.mockResolvedValue({ ok: true, data: [{}] })
  services.countPendingReopeningRequests.mockResolvedValue({ ok: true, data: 3 })
  services.listPendingDiscountRequests.mockResolvedValue({ ok: true, data: [{}, {}, {}, {}] })
})

describe("the bell's counts", () => {
  it("counts discount requests, Sibling ones included, and reopening requests, and nothing else", async () => {
    const counts = await requestCounts(MANAGER)
    expect(counts).toEqual({ "/staff/discounts": 3, "/staff/reopenings": 3 })
    expect(await bellPending(MANAGER, BELL_SCREENS, counts)).toBe(6)
    expect(services.listPendingDiscountRequests).not.toHaveBeenCalled()
  })

  it("leaves out a count that can't be read", async () => {
    services.countPendingReopeningRequests.mockResolvedValue({ ok: false, error: { kind: "unavailable" } })
    const counts = await requestCounts(MANAGER)
    expect(counts).toEqual({ "/staff/discounts": 3 })
  })

  it("reads only the screens the role may decide", async () => {
    const reopenOnly = { permissions: ["leads.view", "reopenings.approve"] as never[] }
    expect(await requestCounts(reopenOnly)).toEqual({ "/staff/reopenings": 3 })
    expect(services.countPendingDiscountRequests).not.toHaveBeenCalled()
    expect(services.listPendingSiblingRequests).not.toHaveBeenCalled()
  })

  it("counts discount requests through the queue for a role that may not view leads", async () => {
    const approver = { permissions: ["discounts.approve"] as never[] }
    const counts = await requestCounts(approver)
    expect(counts).toEqual({})
    expect(await bellPending(approver, ["/staff/discounts"], counts)).toBe(5)
  })
})
