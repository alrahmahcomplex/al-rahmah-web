import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const stubs = vi.hoisted(() => ({
  limit: vi.fn(),
  turnstile: vi.fn(),
  save: vi.fn(),
  client: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7", host: "alrahmah.example" }),
}))
vi.mock("@/lib/rate-limit", () => ({
  checkPublicFormLimit: (input: unknown) => {
    calls.order.push("rate-limit")
    return stubs.limit(input)
  },
}))
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: (input: unknown) => {
    calls.order.push("turnstile")
    return stubs.turnstile(input)
  },
}))
vi.mock("@/utils/supabase/public-form", () => ({ publicFormClient: () => stubs.client() }))
vi.mock("@/lib/services/admission-form", () => ({
  submitAdmissionForm: (...args: unknown[]) => {
    calls.order.push("service")
    return stubs.save(...args)
  },
}))

import { submitAdmissionForm } from "@/app/apply/actions"
import { admissionYears } from "@/lib/admission-form"

const [thisYear] = admissionYears()
const KEY = "3f2b7c1e-8d4a-4b6f-9a0e-1c2d3e4f5a6b"

function posted(overrides: Record<string, unknown> = {}) {
  const data = new FormData()
  data.set("cf-turnstile-response", "token-from-widget")
  data.set(
    "form",
    JSON.stringify({
      submissionKey: KEY,
      parent: { fullName: "Amina Fixture", relationship: "Mother", phone: "0700 000 900" },
      children: [{ fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: thisYear, dayOrBoarding: "Day" }],
      ...overrides,
    }),
  )
  return data
}

const send = (data: FormData) => submitAdmissionForm({ status: "idle" }, data)

beforeEach(() => {
  calls.order = []
  stubs.limit.mockReset().mockResolvedValue("allowed")
  stubs.turnstile.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.client.mockReset().mockReturnValue({ secret: "client" })
  stubs.save.mockReset().mockResolvedValue({ ok: true, data: [{ fullName: "Zawadi Fixture", admissionNumber: "ADMSN-40719" }] })
})

describe("sending the Admission form", () => {
  it("runs the rate limit, then Turnstile, then the service, and confirms with the number", async () => {
    const state = await send(posted())

    expect(calls.order).toEqual(["rate-limit", "turnstile", "service"])
    expect(state).toEqual({ status: "confirmed", children: [{ fullName: "Zawadi Fixture", admissionNumber: "ADMSN-40719" }] })
    expect(stubs.limit).toHaveBeenCalledWith(expect.objectContaining({ key: "admission" }))
    expect(stubs.turnstile).toHaveBeenCalledWith({
      token: "token-from-widget",
      action: "admission",
      remoteIp: "203.0.113.7",
      hostname: "alrahmah.example",
    })
    expect(stubs.save).toHaveBeenCalledWith(
      { secret: "client" },
      {
        submissionKey: KEY,
        parent: { fullName: "Amina Fixture", relationship: "Mother", phone: "0700 000 900" },
        children: [{ fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: thisYear, dayOrBoarding: "Day" }],
      },
    )
  })

  it("stops at the rate limit, before Turnstile, writing nothing", async () => {
    stubs.limit.mockResolvedValue("limited")
    expect(await send(posted())).toEqual({ status: "rate-limited" })
    expect(calls.order).toEqual(["rate-limit"])
  })

  it.each(["missing", "failed", "unavailable"])("refuses as check-failed when Turnstile says %s, writing nothing", async (error) => {
    stubs.turnstile.mockResolvedValue({ ok: false, error })
    expect(await send(posted())).toEqual({ status: "check-failed" })
    expect(calls.order).toEqual(["rate-limit", "turnstile"])
  })

  it("validates after both checks and names the field, writing nothing", async () => {
    const state = await send(posted({ parent: { fullName: "", relationship: "Mother", phone: "0700000900" } }))
    expect(state).toEqual({ status: "invalid", field: "contact_name", child: null })
    expect(calls.order).toEqual(["rate-limit", "turnstile"])
  })

  it("refuses an enrollment year that is no longer on offer, on its child card", async () => {
    const children = [{ fullName: "Z", className: "STD 2", enrollmentYear: thisYear - 1, dayOrBoarding: "Day" }]
    expect(await send(posted({ children }))).toEqual({ status: "invalid", field: "enrollment_year", child: 0 })
    expect(stubs.save).not.toHaveBeenCalled()
  })

  it("refuses a ninth child and the same child twice before saving anything", async () => {
    const child = (fullName: string) => ({ fullName, className: "STD 2", enrollmentYear: thisYear, dayOrBoarding: "Day" })
    const nine = Array.from({ length: 9 }, (_, i) => child(`Pupil ${i + 1}`))
    expect(await send(posted({ children: nine }))).toEqual({ status: "invalid", field: "children", child: null })

    const twice = [child("Zawadi Fixture"), child("Baraka Fixture"), child(" zawadi  fixture ")]
    expect(await send(posted({ children: twice }))).toEqual({ status: "invalid", field: "duplicate_child", child: 2 })
    expect(stubs.save).not.toHaveBeenCalled()
  })

  it("sends eight children in form order and confirms every one", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      fullName: `Pupil ${i + 1}`,
      className: "STD 2",
      enrollmentYear: thisYear,
      dayOrBoarding: "Day",
    }))
    const numbers = eight.map((c, i) => ({ fullName: c.fullName, admissionNumber: `ADMSN-4072${i}` }))
    stubs.save.mockResolvedValue({ ok: true, data: numbers })

    expect(await send(posted({ children: eight }))).toEqual({ status: "confirmed", children: numbers })
    expect(stubs.save.mock.calls[0][1].children).toEqual(eight)
  })

  it("passes on the database refusing the same child twice, on its card", async () => {
    stubs.save.mockResolvedValue({ ok: false, error: { kind: "invalid", field: "duplicate_child", child: 1 } })
    expect(await send(posted())).toEqual({ status: "invalid", field: "duplicate_child", child: 1 })
  })

  it("passes on a phone the database couldn't read", async () => {
    stubs.save.mockResolvedValue({ ok: false, error: { kind: "invalid", field: "phone", child: null } })
    expect(await send(posted())).toEqual({ status: "invalid", field: "phone", child: null })
  })

  it("passes on the earlier send's children when the form was edited after it went through", async () => {
    const children = [{ fullName: "Zawadi Fixture", admissionNumber: "26-0001" }]
    stubs.save.mockResolvedValue({ ok: false, error: { kind: "already-sent", children, complete: true } })
    expect(await send(posted())).toEqual({ status: "already-sent", children, complete: true })
  })

  it("answers unavailable, never a raw error, when saving fails or the secret key is missing", async () => {
    stubs.save.mockResolvedValue({ ok: false, error: { kind: "unavailable" } })
    expect(await send(posted())).toEqual({ status: "unavailable" })

    stubs.save.mockRejectedValue(new Error("connection reset by peer"))
    expect(await send(posted())).toEqual({ status: "unavailable" })

    stubs.client.mockReturnValue(null)
    expect(await send(posted())).toEqual({ status: "unavailable" })
  })
})
