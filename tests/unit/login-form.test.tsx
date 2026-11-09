import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ signIn: vi.fn(), reset: vi.fn(), reveal: vi.fn(() => false), token: "XXXX.DUMMY.TOKEN.XXXX" }))

vi.mock("@/app/login/actions", () => ({ signIn: stubs.signIn }))

// Turnstile's widget, as far as the form sees it: the hidden token field it
// adds, empty while the check is still running, its reset, and reveal, which
// says whether the check is showing its own message.
vi.mock("@/components/turnstile-widget", async () => {
  const { useImperativeHandle } = await import("react")
  return {
    TurnstileWidget: ({ action, ref }: { action: string; ref?: React.Ref<{ reset(): void; reveal(): boolean }> }) => {
      useImperativeHandle(ref, () => ({ reset: stubs.reset, reveal: stubs.reveal }))
      return <input type="hidden" name="cf-turnstile-response" data-action={action} value={stubs.token} readOnly />
    },
  }
})

import { LoginForm } from "@/app/login/login-form"

beforeEach(() => {
  stubs.signIn.mockReset().mockResolvedValue({ error: "invalid-credentials" })
  stubs.reset.mockReset()
  stubs.reveal.mockReset().mockReturnValue(false)
  stubs.token = "XXXX.DUMMY.TOKEN.XXXX"
})

async function submit(email: string, password: string, button: string) {
  for (const [label, value] of [
    [/^(Email|Barua pepe)$/, email],
    [/^(Password|Nenosiri)$/, password],
  ] as const) {
    await userEvent.clear(screen.getByLabelText(label))
    await userEvent.type(screen.getByLabelText(label), value)
  }
  await userEvent.click(screen.getByRole("button", { name: button }))
}

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

  it("carries the sign-in security check inside the form", () => {
    const { container } = render(<LoginForm language="sw" notice={null} />)

    const token = container.querySelector('form input[name="cf-turnstile-response"]')
    expect(token).toHaveAttribute("data-action", "sign-in")
  })

  it("sends nothing while the security check has no token, and says to wait", async () => {
    stubs.token = ""
    render(<LoginForm language="sw" notice={null} />)

    await submit("neema@example.test", "a-password", "Ingia")

    expect(await screen.findByRole("alert")).toHaveTextContent("Subiri ukaguzi wa usalama ukamilike, kisha uingie.")
    expect(stubs.signIn).not.toHaveBeenCalled()
    expect(stubs.reset).not.toHaveBeenCalled()
  })

  it.each([
    ["the check is still running", false],
    ["the check needs a click", true],
  ])("keeps the email and password when Ingia is pressed while %s (#273)", async (_case, revealed) => {
    stubs.token = ""
    stubs.reveal.mockReturnValue(revealed)
    render(<LoginForm language="sw" notice={null} />)

    await submit("neema@example.test", "a-password", "Ingia")

    await vi.waitFor(() => expect(stubs.reveal).toHaveBeenCalled())
    expect(screen.getByLabelText("Barua pepe")).toHaveValue("neema@example.test")
    expect(screen.getByLabelText("Nenosiri")).toHaveValue("a-password")
  })

  it("after a wrong password, keeps the email, clears the password and puts the cursor there", async () => {
    render(<LoginForm language="en" notice={null} />)

    await submit("someone@example.test", "wrong-password", "Log In")

    await screen.findByRole("alert")
    expect(screen.getByLabelText("Email")).toHaveValue("someone@example.test")
    expect(screen.getByLabelText("Password")).toHaveValue("")
    expect(screen.getByLabelText("Password")).toHaveFocus()
  })

  // A value attribute can be read by injected CSS (attribute selectors) or a
  // browser extension, so the typed password must live only in the box (#278).
  it("never copies the typed password into the box's value attribute", async () => {
    stubs.signIn.mockResolvedValue({ error: "check-failed" })
    render(<LoginForm language="en" notice={null} />)
    const password = screen.getByLabelText("Password")

    await userEvent.type(password, "secret-password")
    expect(password.getAttribute("value") ?? "").toBe("")
    await userEvent.click(screen.getByRole("button", { name: "Show password" }))
    expect(password.getAttribute("value") ?? "").toBe("")

    await submit("someone@example.test", "secret-password", "Log In")
    await screen.findByRole("alert")
    expect(password).toHaveValue("secret-password")
    expect(password.getAttribute("value") ?? "").toBe("")
  })

  it("clears the password and puts the cursor there after each wrong password, even the same answer twice", async () => {
    const wrong = { error: "invalid-credentials" } as const
    stubs.signIn.mockResolvedValue(wrong)
    render(<LoginForm language="en" notice={null} />)

    await submit("someone@example.test", "wrong-password", "Log In")
    await screen.findByRole("alert")
    await userEvent.click(screen.getByLabelText("Email"))
    await submit("someone@example.test", "wrong-again", "Log In")

    await vi.waitFor(() => expect(stubs.signIn).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(screen.getByLabelText("Password")).toHaveValue(""))
    expect(screen.getByLabelText("Password")).toHaveFocus()
  })

  it("keeps a new password typed while a wrong one was being checked", async () => {
    let answer: (value: { error: "invalid-credentials" }) => void = () => {}
    stubs.signIn.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    render(<LoginForm language="en" notice={null} />)

    await submit("someone@example.test", "wrong-password", "Log In")
    await vi.waitFor(() => expect(stubs.signIn).toHaveBeenCalledTimes(1))
    await userEvent.clear(screen.getByLabelText("Password"))
    await userEvent.type(screen.getByLabelText("Password"), "the-right-one")
    await act(async () => answer({ error: "invalid-credentials" }))

    await screen.findByRole("alert")
    expect(screen.getByLabelText("Password")).toHaveValue("the-right-one")
  })

  it("keeps both after an answer that isn't the person's mistake", async () => {
    stubs.signIn.mockResolvedValue({ error: "check-failed" })
    render(<LoginForm language="en" notice={null} />)

    await submit("someone@example.test", "a-password", "Log In")

    await screen.findByRole("alert")
    expect(screen.getByLabelText("Email")).toHaveValue("someone@example.test")
    expect(screen.getByLabelText("Password")).toHaveValue("a-password")
  })

  it("lets a check that needs a click speak for itself, and sends nothing", async () => {
    stubs.token = ""
    stubs.reveal.mockReturnValue(true)
    render(<LoginForm language="sw" notice={null} />)

    await submit("neema@example.test", "a-password", "Ingia")

    expect(stubs.reveal).toHaveBeenCalled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(stubs.signIn).not.toHaveBeenCalled()
  })

  it("shows a refused security check as a check message, not a wrong password, and gets a fresh token", async () => {
    stubs.signIn.mockResolvedValue({ error: "check-failed" })
    render(<LoginForm language="en" notice={null} />)

    await submit("neema@example.test", "a-password", "Log In")

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("The security check didn't finish. Try again.")
    expect(alert).toHaveTextContent("Code: captcha_failed")
    expect(alert).not.toHaveTextContent("Wrong email or password.")
    expect(stubs.reset).toHaveBeenCalledTimes(1)
  })

  it("gets a fresh token after every failed answer, even the same one twice", async () => {
    render(<LoginForm language="en" notice={null} />)

    await submit("someone@example.test", "wrong-password", "Log In")
    await screen.findByRole("alert")
    await submit("someone@example.test", "wrong-password", "Log In")

    await vi.waitFor(() => expect(stubs.signIn).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(stubs.reset).toHaveBeenCalledTimes(2))
  })
})
