import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))

import { LanguageSwitch } from "@/components/language-switch"
import { PageLanguageProvider, storeLanguage, SyncPageLanguage, useLanguageChosen, usePageLanguage } from "@/components/page-language"

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
        <LanguageSwitch language="sw" returnTo="/auth/forgot-password" inPlace />
        <Probe />
      </PageLanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "English" }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(shown))
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe("saving the language", () => {
  // Each save waits for its answer: true sets the cookie, false fails it.
  function slowLine() {
    const answers: Array<(ok: boolean) => void> = []
    const sent: Array<FormDataEntryValue | null> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        sent.push((init.body as FormData).get("lang"))
        return new Promise<Response>((resolve, reject) =>
          answers.push((ok) => (ok ? resolve(new Response(null, { status: 204 })) : reject(new TypeError("offline")))),
        )
      }),
    )
    return { answers, sent }
  }

  it("sends a later pick only after the earlier one answers, and only the later one counts", async () => {
    const { answers, sent } = slowLine()

    // The first-visit card's pick on a slow line, then the Menu's.
    const first = storeLanguage("en")
    const second = storeLanguage("sw")
    await waitFor(() => expect(sent).toEqual(["en"]))

    answers[0](true)
    await waitFor(() => expect(sent).toEqual(["en", "sw"]))
    answers[1](true)

    expect(await first).toBeNull()
    expect(await second).toBe("sw")
  })

  it("shows the earlier pick when the later save fails after the earlier one set the cookie", async () => {
    const { answers, sent } = slowLine()

    const first = storeLanguage("en")
    const second = storeLanguage("sw")
    await waitFor(() => expect(sent).toEqual(["en"]))
    answers[0](true)
    await waitFor(() => expect(sent).toEqual(["en", "sw"]))
    answers[1](false)

    expect(await first).toBeNull()
    expect(await second).toBe("en")
  })

  it("changes nothing when every save fails, and a later save still goes out", async () => {
    const { answers, sent } = slowLine()

    const failed = storeLanguage("en")
    await waitFor(() => expect(sent).toEqual(["en"]))
    answers[0](false)
    expect(await failed).toBeNull()

    const next = storeLanguage("sw")
    await waitFor(() => expect(sent).toEqual(["en", "sw"]))
    answers[1](true)
    expect(await next).toBe("sw")
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
