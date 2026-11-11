import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// app/tokens.css is the one place the --gf-* tokens are declared (#317).
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")
const tokens = read("app/tokens.css")
const guidedForm = read("components/guided-form/guided-form.css")
const globals = read("app/globals.css")

function declared(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf("}", start))
  return new Map([...body.matchAll(/(--gf-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

describe("design tokens", () => {
  it("keeps every value the Admission form shipped with", () => {
    // Retuning one of these changes the public pages; add a new token instead.
    expect(Object.fromEntries(declared(tokens, ":root"))).toMatchObject({
      "--gf-indigo": "#0900bb",
      "--gf-indigo-night": "#03004d",
      "--gf-mist": "#e0dcf9",
      "--gf-whisper": "#f2f0fc",
      "--gf-chrome": "#f8f7fd",
      "--gf-orange": "#ee7300",
      "--gf-ember": "#cc6200",
      "--gf-orange-deep": "#b35500",
      "--gf-orange-tint": "#fff4e8",
      "--gf-paper": "#ffffff",
      "--gf-ink": "#1e293b",
      "--gf-ink-soft": "#475569",
      "--gf-quiet": "#64748b",
      "--gf-line": "rgb(9 0 187 / 0.22)",
      "--gf-line-strong": "rgb(9 0 187 / 0.45)",
      "--gf-red": "#c81e1e",
      "--gf-red-tint": "#fef2f2",
      "--gf-green": "#0f7a3d",
      "--gf-green-tint": "#eefbf3",
      "--gf-ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      "--gf-ease-io": "cubic-bezier(0.65, 0, 0.35, 1)",
      "--gf-lift": "0 30px 80px -15px rgb(9 0 187 / 0.25)",
      "--gf-sun": "0 4px 6px -1px rgb(238 115 0 / 0.25), 0 2px 4px -2px rgb(238 115 0 / 0.25)",
      "--gf-t-fast": "140ms",
      "--gf-t-med": "280ms",
      "--gf-t-slow": "420ms",
      "--gf-fold": "300ms",
      "--gf-fade": "300ms",
    })
    const reduced = { "--gf-t-fast": "1ms", "--gf-t-med": "120ms", "--gf-t-slow": "160ms", "--gf-fold": "0ms", "--gf-fade": "120ms" }
    expect(Object.fromEntries(declared(tokens, "html.rm"))).toMatchObject(reduced)
    expect(Object.fromEntries(declared(tokens, "@media (prefers-reduced-motion: reduce) {\n  :root"))).toMatchObject(reduced)
  })

  it("holds the prototype's additions, with the sidebar timing cut under reduced motion", () => {
    const root = declared(tokens, ":root")
    expect(root.get("--gf-indigo-deep")).toBe("#070099")
    expect(root.get("--gf-line-soft")).toBe("rgb(9 0 187 / 0.12)")
    expect(root.get("--gf-card-shadow")).toBe("0 1px 2px rgb(9 0 187 / 0.04), 0 12px 28px -18px rgb(9 0 187 / 0.22)")
    expect(root.get("--gf-wash")).toBe("linear-gradient(135deg, #f2f0fc 0%, rgb(224 220 249 / 0.5) 45%, #fff 100%)")
    expect(root.get("--gf-side")).toBe("460ms")
    expect(declared(tokens, "html.rm").get("--gf-side")).toBe("1ms")
    expect(declared(tokens, "@media (prefers-reduced-motion: reduce) {\n  :root").get("--gf-side")).toBe("1ms")
  })

  it("lets the guided form read the tokens instead of declaring its own", () => {
    expect(guidedForm).not.toMatch(/--gf-[\w-]+\s*:/)
    const all = new Set(tokens.matchAll(/(--gf-[\w-]+)\s*:/g).map((m) => m[1]))
    for (const css of [guidedForm, globals]) {
      for (const [, name] of css.matchAll(/var\((--gf-[\w-]+)/g)) expect(all, name).toContain(name)
    }
  })

  it("is loaded by the root layout", () => {
    expect(read("app/layout.tsx")).toMatch(/^import "\.\/tokens\.css"$/m)
  })

  it("gives shadcn the brand only inside the new shell", () => {
    const shell = globals.slice(globals.indexOf('[data-shell="new"] {'))
    const body = shell.slice(0, shell.indexOf("}"))
    expect(body).toMatch(/--primary: var\(--gf-indigo\);/)
    expect(body).toMatch(/--ring: var\(--gf-indigo\);/)
    expect(body).toMatch(/--border: var\(--gf-line\);/)
    expect(body).toMatch(/--radius: 1rem;/)
  })
})
