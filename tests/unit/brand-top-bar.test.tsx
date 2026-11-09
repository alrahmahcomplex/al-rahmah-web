import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ImgHTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ setLanguage: vi.fn() }))

vi.mock("@/app/actions/language", () => ({ setLanguage: stubs.setLanguage }))
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />
  },
}))

import { BrandTopBar } from "@/components/brand/brand-top-bar"

beforeEach(() => {
  stubs.setLanguage.mockReset().mockResolvedValue(undefined)
})

describe("BrandTopBar", () => {
  it.each([
    ["schools", "AL-RAHMAH SCHOOLS"],
    ["complex", "AL-RAHMAH COMPLEX"],
  ] as const)("shows the %s badge", (variant, text) => {
    render(<BrandTopBar variant={variant} language="sw" />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it.each([
    ["sw", "Al-Rahmah: ukurasa wa nyumbani"],
    ["en", "Al-Rahmah home page"],
  ] as const)("in %s, links the round logo to the school website in the same tab", (language, label) => {
    render(<BrandTopBar variant="schools" language={language} />)
    const link = screen.getByRole("link", { name: label })

    expect(link).toHaveAttribute("href", "https://alrahmahcomplex.or.tz/")
    expect(link).not.toHaveAttribute("target")
    expect(link.querySelector("img")).toHaveAttribute("src", "/brand/logo-round.png")
  })

  it("opens a menu with the language control and no clear item when the page has no form", async () => {
    render(<BrandTopBar variant="complex" language="sw" />)
    const button = screen.getByRole("button", { name: "Menyu" })
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("group", { name: "Lugha" })).toBeNull()

    await userEvent.click(button)

    expect(button).toHaveAttribute("aria-expanded", "true")
    const group = screen.getByRole("group", { name: "Lugha" })
    expect(within(group).getByRole("button", { name: "Kiswahili" })).toHaveAttribute("aria-pressed", "true")
    expect(within(group).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.queryByRole("button", { name: "Futa fomu yote" })).toBeNull()
  })

  it("asks before clearing the form, and clears only on yes", async () => {
    const onClearForm = vi.fn()
    render(<BrandTopBar variant="schools" language="sw" onClearForm={onClearForm} />)
    await userEvent.click(screen.getByRole("button", { name: "Menyu" }))

    await userEvent.click(screen.getByRole("button", { name: "Futa fomu yote" }))
    expect(screen.getByText("Futa majibu yote?")).toBeInTheDocument()
    expect(onClearForm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Hapana" }))
    expect(screen.queryByText("Futa majibu yote?")).toBeNull()
    expect(onClearForm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Futa fomu yote" }))
    await userEvent.click(screen.getByRole("button", { name: "Ndiyo, futa" }))
    expect(onClearForm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Menyu" })).toHaveAttribute("aria-expanded", "false")
  })

  it("speaks English in English", async () => {
    render(<BrandTopBar variant="schools" language="en" onClearForm={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: "Menu" }))

    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear the whole form" }))
    expect(screen.getByText("Clear every answer?")).toBeInTheDocument()
  })

  it("closes on Escape and gives focus back to the menu button", async () => {
    render(<BrandTopBar variant="schools" language="sw" onClearForm={() => {}} />)
    const button = screen.getByRole("button", { name: "Menyu" })
    await userEvent.click(button)
    expect(screen.getByRole("button", { name: "Kiswahili" })).toHaveFocus()

    await userEvent.keyboard("{Escape}")

    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("group", { name: "Lugha" })).toBeNull()
    expect(button).toHaveFocus()
  })

  it("keeps Tab inside the open menu", async () => {
    render(<BrandTopBar variant="schools" language="sw" onClearForm={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: "Menyu" }))

    await userEvent.tab()
    expect(screen.getByRole("button", { name: "English" })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole("button", { name: "Futa fomu yote" })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole("button", { name: "Kiswahili" })).toHaveFocus()
  })

  it("posts the chosen language through setLanguage", async () => {
    render(<BrandTopBar variant="schools" language="sw" />)
    await userEvent.click(screen.getByRole("button", { name: "Menyu" }))
    await userEvent.click(screen.getByRole("button", { name: "English" }))

    expect(stubs.setLanguage).toHaveBeenCalledTimes(1)
    expect((stubs.setLanguage.mock.calls[0][0] as FormData).get("lang")).toBe("en")
  })
})
