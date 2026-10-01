import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const checkRateLimit = vi.hoisted(() => vi.fn())
vi.mock("@vercel/firewall", () => ({ checkRateLimit }))

import { checkPublicFormLimit } from "@/lib/rate-limit"

function requestHeaders(ip: string | null = "198.51.100.7") {
  const headers = new Headers({ host: "alrahmah.example" })
  if (ip) headers.set("x-real-ip", ip)
  return headers
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "1")
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  checkRateLimit.mockReset()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("checkPublicFormLimit", () => {
  it("is limited when the firewall rule says so", async () => {
    checkRateLimit.mockResolvedValueOnce({ rateLimited: true })

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("limited")
  })

  it("is allowed under the limit", async () => {
    checkRateLimit.mockResolvedValueOnce({ rateLimited: false })

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("allowed")
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("counts each form per client IP on the shared public-forms rule", async () => {
    checkRateLimit.mockResolvedValue({ rateLimited: false })
    const headers = requestHeaders()

    await checkPublicFormLimit({ headers, key: "admission" })
    await checkPublicFormLimit({ headers, key: "agent" })

    expect(checkRateLimit).toHaveBeenNthCalledWith(1, "public-forms", {
      headers,
      rateLimitKey: "admission:198.51.100.7",
    })
    expect(checkRateLimit).toHaveBeenNthCalledWith(2, "public-forms", {
      headers,
      rateLimitKey: "agent:198.51.100.7",
    })
  })

  it("lets the form through and logs when the SDK reports an error", async () => {
    checkRateLimit.mockResolvedValueOnce({ rateLimited: false, error: "not-found" })

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("allowed")
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not-found"))
  })

  it("limits the form when the firewall reports it blocked", async () => {
    checkRateLimit.mockResolvedValueOnce({ rateLimited: true, error: "blocked" })

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("limited")
  })

  it("lets the form through and logs when the SDK throws", async () => {
    checkRateLimit.mockRejectedValueOnce(new Error("Unexpected rate-limit API response status 'public-forms': 500"))

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("allowed")
    expect(console.warn).toHaveBeenCalled()
  })

  it("lets every run outside Vercel through and logs, without calling the firewall", async () => {
    vi.stubEnv("VERCEL", "")

    await expect(checkPublicFormLimit({ headers: requestHeaders(), key: "admission" })).resolves.toBe("allowed")
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it("lets the form through and logs when the client IP is unknown, rather than share one bucket", async () => {
    await expect(checkPublicFormLimit({ headers: requestHeaders(null), key: "admission" })).resolves.toBe("allowed")
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})
