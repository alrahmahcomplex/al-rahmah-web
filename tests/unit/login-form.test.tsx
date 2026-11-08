import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ signIn: vi.fn() }))

vi.mock("@/app/login/actions", () => ({ signIn: stubs.signIn }))

import { LoginForm } from "@/app/login/login-form"

beforeEach(() => {
  stubs.signIn.mockReset().mockResolvedValue({ error: "invalid-credentials" })
})

describe("the one sign-in form", () => {
  it.each([
    ["sw", "Barua pepe", "Nenosiri", "Umesahau nenosiri?"],
    ["en", "Email", "Password", "Forgot your password?"],
  ] as const)("in %s, names each box by a label and shows it as the placeholder", (language, email, password, forgot) => {
    render(<LoginForm language={language} notice={null} />)

    expect(screen.getByLabelText(email)).toHaveAttribute("placeholder", email)
    expect(screen.getByLabelText(password)).toHaveAttribute("placeholder", password)
    expect(screen.getByRole("link", { name: forgot })).toHaveAttribute("href", "/login/forgot-password")
    expect(screen.queryByText(/Discount code holders/i)).toBeNull()
  })

  it("after a wrong password, puts the reset link under the warning, once", async () => {
    render(<LoginForm language="en" notice={null} />)

    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test")
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password")
    await userEvent.click(screen.getByRole("button", { name: "Log In" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Wrong email or password.")
    expect(alert.querySelector('a[href="/login/forgot-password"]')).toHaveTextContent("Forgot your password?")
    expect(screen.getAllByRole("link", { name: "Forgot your password?" })).toHaveLength(1)
  })

  it("shows a refusal's reason code, without a reset link", async () => {
    stubs.signIn.mockResolvedValue({ error: "switched-off" })
    render(<LoginForm language="sw" notice={null} />)

    await userEvent.type(screen.getByLabelText("Barua pepe"), "neema@example.test")
    await userEvent.type(screen.getByLabelText("Nenosiri"), "a-password")
    await userEvent.click(screen.getByRole("button", { name: "Ingia" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Msimbo: switched_off")
    expect(alert.querySelector("a")).toBeNull()
  })
})
