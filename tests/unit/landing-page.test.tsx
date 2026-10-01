import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))

// lib/office.ts is server-only, which vitest can't load. Stand in a different
// number, so the test shows the page takes the phone from that constant.
vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
  }),
}))
// The home page must render with Supabase down: any use of a Supabase client
// fails this test.
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the home page must not read Supabase")
  },
}))

import HomePage from "@/app/page"

beforeEach(() => jar.values.clear())

async function renderHome() {
  render(await HomePage())
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
    jar.values.set("lang", "en")
    await renderHome()

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/apply")
    expect(screen.getByText(/Islamic values/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Omba sasa" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true")
  })

  it.each(["sw", "en"])("gives the office phone as a tap-to-call link in %s", async (lang) => {
    jar.values.set("lang", lang)
    await renderHome()

    const call = screen.getByRole("link", { name: /\+255 700 000 001/ })
    expect(call).toHaveAttribute("href", "tel:+255700000001")
  })

  it.each(["sw", "en"])("keeps the Staff sign-in link in %s", async (lang) => {
    jar.values.set("lang", lang)
    await renderHome()

    expect(screen.getByRole("link", { name: "Staff sign-in" })).toHaveAttribute("href", "/login")
  })
})
