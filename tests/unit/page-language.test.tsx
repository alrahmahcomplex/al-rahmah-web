import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))

import { LanguageSwitch } from "@/components/language-switch"
import { PageLanguageProvider, SyncPageLanguage, useLanguageChosen, usePageLanguage } from "@/components/page-language"

// What the switches leave in the shared page language, which decides the words
// on the cached pages and whether the first-visit card asks again.
function Probe() {
  return (
    <p data-testid="probe">
      {usePageLanguage("sw")} {useLanguageChosen() ? "picked" : "not picked"}
    </p>
  )
}

function respond(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (ok ? new Response(null, { status: 204 }) : Promise.reject(new TypeError("offline")))),
  )
}

beforeEach(() => router.refresh.mockReset())
afterEach(() => vi.unstubAllGlobals())

describe("the switch on /", () => {
  it("records the pick and fetches the other copy once the cookie is set", async () => {
    respond(true)
    render(
      <PageLanguageProvider>
        <LanguageSwitch language="sw" returnTo="/" />
        <Probe />
      </PageLanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "English" }))

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("en picked"))
    expect(fetch).toHaveBeenCalledWith("/api/language", expect.objectContaining({ method: "POST" }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it("changes nothing when the cookie can't be set, so the first-visit card still asks", async () => {
    respond(false)
    render(
      <PageLanguageProvider>
        <LanguageSwitch language="sw" returnTo="/" />
        <Probe />
      </PageLanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "English" }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByTestId("probe")).toHaveTextContent("sw not picked")
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe("the in-place switch", () => {
  it.each([
    [true, "en picked"],
    [false, "sw not picked"],
  ] as const)("when the cookie is set: %s, the page shows %s", async (ok, shown) => {
    respond(ok)
    render(
      <PageLanguageProvider>
        <LanguageSwitch language="sw" returnTo="/login/forgot-password" inPlace />
        <Probe />
      </PageLanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "English" }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(shown))
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe("a page rendered per request", () => {
  it("reports its cookie's language without counting as a pick", () => {
    render(
      <PageLanguageProvider>
        <SyncPageLanguage language="en" />
        <Probe />
      </PageLanguageProvider>,
    )
    expect(screen.getByTestId("probe")).toHaveTextContent("en not picked")
  })
})
