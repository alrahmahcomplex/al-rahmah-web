import { render, screen } from "@testing-library/react"
import type { ImgHTMLAttributes } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />
  },
}))

import { AuthCard } from "@/components/auth-card"

// The card's <main> carries the page's language, on the pages rendered per
// request and on the cached forgotten-password page alike, so a screen reader
// reads Swahili as Swahili even before JavaScript runs.
describe("AuthCard", () => {
  it.each(["sw", "en"] as const)("marks a page rendered per request as %s", (language) => {
    render(<AuthCard language={language}>card</AuthCard>)
    expect(screen.getByRole("main")).toHaveAttribute("lang", language)
    expect(screen.getByRole("main")).not.toHaveAttribute("language")
  })

  it.each(["sw", "en"] as const)("marks the cached page as %s and sends its switch back there", (language) => {
    render(
      <AuthCard language={language} returnTo="/login/forgot-password">
        card
      </AuthCard>,
    )
    expect(screen.getByRole("main")).toHaveAttribute("lang", language)
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/login/forgot-password")
  })

  it("gives a page rendered per request no address to return to", () => {
    render(<AuthCard language="sw">card</AuthCard>)
    expect(document.querySelector('input[name="return_to"]')).toBeNull()
  })
})
