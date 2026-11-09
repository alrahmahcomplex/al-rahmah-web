import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const publicFormClient = vi.fn()
const getAdmissionApplicationCount = vi.fn()
const getInterviewDiscount = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("@/utils/supabase/public-form", () => ({ publicFormClient: () => publicFormClient() }))
vi.mock("@/lib/services/admission-applications", () => ({
  getAdmissionApplicationCount: (client: unknown) => getAdmissionApplicationCount(client),
}))
vi.mock("@/lib/services/referral", () => ({ getInterviewDiscount: (client: unknown) => getInterviewDiscount(client) }))

import { dynamic, GET } from "@/app/api/apply/live/route"

const client = { secret: true }

async function answer() {
  const response = await GET()
  return { response, body: await response.json() }
}

describe("GET /api/apply/live", () => {
  beforeEach(() => {
    publicFormClient.mockReturnValue(client)
    getAdmissionApplicationCount.mockResolvedValue({ ok: true, data: 1284 })
    getInterviewDiscount.mockResolvedValue({ ok: true, data: 10000 })
  })

  afterEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
  })

  it("returns the raw count and the discount, read with the secret-key client", async () => {
    const { response, body } = await answer()
    expect(response.status).toBe(200)
    expect(body).toEqual({ applications: 1284, discount: 10000 })
    expect(getAdmissionApplicationCount).toHaveBeenCalledWith(client)
    expect(getInterviewDiscount).toHaveBeenCalledWith(client)
  })

  it("returns a count below 100 as it is; the form applies the minimum", async () => {
    getAdmissionApplicationCount.mockResolvedValue({ ok: true, data: 12 })
    expect((await answer()).body).toEqual({ applications: 12, discount: 10000 })
  })

  it("is cached at the CDN for 30 seconds, never in the browser, and is JSON", async () => {
    const { response } = await answer()
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=120")
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(dynamic).toBe("force-dynamic")
  })

  it("answers nulls when the secret key is missing, without reading anything", async () => {
    publicFormClient.mockReturnValue(null)
    const { response, body } = await answer()
    expect(response.status).toBe(200)
    expect(body).toEqual({ applications: null, discount: null })
    expect(getAdmissionApplicationCount).not.toHaveBeenCalled()
    expect(getInterviewDiscount).not.toHaveBeenCalled()
  })

  it("answers nulls when building the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    publicFormClient.mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
    })
    expect((await answer()).body).toEqual({ applications: null, discount: null })
  })

  it("answers null for a figure whose read fails, and keeps the other", async () => {
    getAdmissionApplicationCount.mockResolvedValue({ ok: false, error: "unavailable" })
    expect((await answer()).body).toEqual({ applications: null, discount: 10000 })

    getAdmissionApplicationCount.mockResolvedValue({ ok: true, data: 300 })
    getInterviewDiscount.mockRejectedValue(new Error("network"))
    expect((await answer()).body).toEqual({ applications: 300, discount: null })
  })
})
