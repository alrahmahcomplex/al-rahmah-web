import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// lib/office.ts is server-only, which vitest can't load. Stand in a different
// number, so the test shows the page takes the phone from that constant.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
// The page reads nothing from the request: its language comes from the
// language state it was built for. Any read of the cookies fails this test.
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("the home page must not read the request")
  },
}))
// The home page must render with Supabase down: any use of a Supabase client
// fails this test.
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the home page must not read Supabase")
  },
}))

import HomePage, { generateMetadata, generateStaticParams } from "@/app/by-language/[state]/page"
import type { LanguageState } from "@/lib/language-state"

async function renderHome(state: LanguageState = "first") {
  render(await HomePage({ params: Promise.resolve({ state }) }))
}

describe("the home page", () => {
  it("speaks Swahili to a visitor who has not chosen a language", async () => {
    await renderHome()

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Al-Rahmah Complex" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Al-Rahmah Logo" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Omba sasa" })).toHaveAttribute("href", "/apply")
    expect(screen.getByText(/maadili ya Kiislamu/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Kiswahili" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false")
  })

  it("speaks English once the visitor has chosen it", async () => {
    await renderHome("en")

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/apply")
    expect(screen.getByText(/Islamic values/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Omba sasa" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true")
  })

  it.each(["first", "sw", "en"] as const)("gives the office phone as a tap-to-call link in %s", async (state) => {
    await renderHome(state)

    const call = screen.getByRole("link", { name: /\+255 700 000 001/ })
    expect(call).toHaveAttribute("href", "tel:+255700000001")
  })

  it.each(["first", "sw", "en"] as const)("keeps the Staff sign-in link in %s", async (state) => {
    await renderHome(state)

    expect(screen.getByRole("link", { name: "Staff sign-in" })).toHaveAttribute("href", "/login")
  })

  it("speaks Swahili, with no card, to a visitor with any other lang value", async () => {
    await renderHome("sw")

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("link", { name: "Omba sasa" })).toBeInTheDocument()
  })

  it("is built once per language state", () => {
    expect(generateStaticParams()).toEqual([{ state: "first" }, { state: "sw" }, { state: "en" }])
  })

  it.each([
    ["first", "maadili ya Kiislamu"],
    ["sw", "maadili ya Kiislamu"],
    ["en", "Islamic values"],
  ] as const)("describes itself in the state's language (%s)", async (state, words) => {
    const metadata = await generateMetadata({ params: Promise.resolve({ state }) })
    expect(metadata.title).toBe("Al-Rahmah Complex")
    expect(metadata.description).toContain(words)
  })

  it("sends the switch back to the public address", async () => {
    await renderHome("en")
    const form = screen.getByRole("button", { name: "Kiswahili" }).closest("form")
    expect(form?.querySelector('input[name="return_to"]')).toHaveValue("/")
  })
})
