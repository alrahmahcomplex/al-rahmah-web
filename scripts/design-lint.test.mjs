import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { countPills, hexColours, lint, newRoutes, readRouteLooks, syntaxErrors, UPRIGHT_EXO_ALLOWED, uprightExoInCss, uprightExoInScript } from "./design-lint.mjs"

const lines = (problems) => problems.map((p) => p.line)

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "design-lint-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function withTree(files, check) {
  const root = tree(files)
  try {
    check(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("an Exo class needs a bare italic in the same class string", () => {
  assert.deepEqual(lines(uprightExoInScript(`<h1 className="font-exo text-2xl italic" />`)), [])
  assert.deepEqual(lines(uprightExoInScript(`const a = 1\n<p className="font-exo text-sm" />`)), [2])
  assert.deepEqual(lines(uprightExoInScript(`<p className='md:font-exo italic' />`)), [])
  assert.deepEqual(lines(uprightExoInScript("<p className={`font-exo ${x}`} />")), [1])
  assert.deepEqual(lines(uprightExoInScript(`<p className="font-[family-name:var(--font-exo)]" />`)), [1])
})

test("not-italic and a variant-only italic count as upright", () => {
  assert.deepEqual(lines(uprightExoInScript(`<p className="font-exo italic md:not-italic" />`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`<p className="font-exo md:italic" />`)), [1])
})

test("other strings that mention Exo are not classes", () => {
  assert.deepEqual(lines(uprightExoInScript(`localFont({ variable: "--font-exo" })\nconst s = "font-exo-ish"`)), [])
})

test("a className value that spans lines is read whole", () => {
  assert.deepEqual(lines(uprightExoInScript(`<p\n  className="font-exo\n    text-xl"\n/>`)), [2])
  assert.deepEqual(lines(uprightExoInScript(`<p className="font-exo\n  text-xl italic" />`)), [])
})

test("italic may come from another string of the same class expression", () => {
  assert.deepEqual(lines(uprightExoInScript(`<p className={cn("font-exo", "italic")} />`)), [])
  assert.deepEqual(lines(uprightExoInScript(`cn(buttonVariants({ variant: "orange" }), "font-exo text-lg",\n  "italic")`)), [])
  assert.deepEqual(lines(uprightExoInScript(`<p className={cn("font-exo", "text-sm")} />`)), [1])
  // a ternary's Exo branch does not lend its italic to the other
  assert.deepEqual(lines(uprightExoInScript(`<p className={x ? "font-exo italic" : "font-exo"} />`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`<p className={cn("font-exo", "italic", "md:not-italic")} />`)), [1])
  // outside the expression, another string does not count
  assert.deepEqual(lines(uprightExoInScript(`const a = "italic"\n<p className="font-exo" />`)), [2])
})

test("comments and JSX apostrophes are not strings", () => {
  assert.deepEqual(lines(uprightExoInScript(`// "font-exo"\n/* 'font-exo' */\n<p>Don't</p>;\n<b className="font-exo" />`)), [4])
  assert.deepEqual(lines(uprightExoInScript(`{/* <p className="font-exo" /> */}`)), [])
})

// The inputs the hand tokenizer misread (#338).
test("a regex literal holding /* or // is not a comment", () => {
  const source = `const r = /[/*]/\nconst s = /a\\/\\/b/\nconst c = "#fff"\n<CountPill />;\n<p className="font-exo" />`
  assert.deepEqual(lines(hexColours(source)), [3])
  assert.deepEqual(lines(countPills(source)), [4])
  assert.deepEqual(lines(uprightExoInScript(source)), [5])
})

test("apostrophes in JSX text do not pair up as a string", () => {
  assert.deepEqual(lines(uprightExoInScript(`<p>Don't <b className='font-exo'>forget</b> the student's name</p>`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`<p>Don't <b className='font-exo italic'>forget</b> the student's name</p>`)), [])
})

test("nested template literals are read one by one", () => {
  // Italic in both branches: always italic.
  assert.deepEqual(lines(uprightExoInScript("<p className={`font-exo ${x ? `italic` : `italic text-sm`}`} />")), [])
  assert.deepEqual(lines(uprightExoInScript("<p className={`font-exo ${x ? `italic` : ``}`} />")), [1])
  assert.deepEqual(lines(uprightExoInScript("<p className={`px-2 ${x ? `a` : `b`} font-exo`} />")), [1])
  assert.deepEqual(lines(uprightExoInScript("const a = `${`x`}`\nconst b = `font-exo ${`y`} italic`")), [])
})

test("a conditional string lends no italic; each branch is checked on its own", () => {
  assert.deepEqual(lines(uprightExoInScript(`cn("font-exo", enabled && "italic")`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`<p className={active ? "italic" : "font-exo"} />`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`cn("font-exo", { italic: on, "italic": on })`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`cn("font-exo", wrap("italic"))`)), [1])
  // italic in every branch, or applied whatever the condition
  assert.deepEqual(lines(uprightExoInScript(`cn("font-exo", big ? "italic text-lg" : "italic")`)), [])
  assert.deepEqual(lines(uprightExoInScript(`cn(on && "font-exo", "italic")`)), [])
  assert.deepEqual(lines(uprightExoInScript(`<p className={on ? cn("font-exo", ["italic"]) : "font-sans"} />`)), [])
  assert.deepEqual(lines(uprightExoInScript(`cva("italic", { variants: { tone: { brand: "font-exo" } } })`)), [])
  assert.deepEqual(lines(uprightExoInScript(`cva("font-sans", { variants: { tone: { brand: "font-exo", lean: "italic" } } })`)), [1])
  // a not-italic that may apply with the Exo string makes it upright; one in
  // the other branch of a ?: does not
  assert.deepEqual(lines(uprightExoInScript(`cn("font-exo", "italic", on && "md:not-italic")`)), [1])
  assert.deepEqual(lines(uprightExoInScript(`cn("italic", on ? "font-exo" : "not-italic")`)), [])
})

test("a hex is found in strings, templates and JSX text, not in names", () => {
  assert.deepEqual(lines(hexColours("const a = `x ${y} #fff`;\n<p>#0900bb</p>")), [1, 2])
  assert.deepEqual(lines(hexColours(`class A { #fade = 1; f() { return this.#fade } }`)), [])
})

test("syntax errors are reported, since a recovered tree can leave code out", () => {
  assert.match(syntaxErrors(`const = 1`)[0].message, /cannot parse/)
  assert.deepEqual(syntaxErrors(`const a = <T,>(x: T) => x`, "a.tsx"), [])
  assert.deepEqual(syntaxErrors(`const a = <T>(x: T) => x`, "a.ts"), [])
  withTree({ "components/kit/card.tsx": `export const C = () => <div>` }, (root) => {
    assert.deepEqual(lint(root).map((p) => `${p.file}:${p.line}`), ["components/kit/card.tsx:1"])
  })
  assert.match(readRouteLooks(`export const looks = { "/staff": "new" `).errors[0].message, /cannot parse/)
})

test("a stylesheet rule naming Exo needs italic", () => {
  assert.deepEqual(lines(uprightExoInCss(`.a { font-family: var(--font-exo), "Exo"; font-style: italic; }`)), [])
  assert.deepEqual(lines(uprightExoInCss(`.a { font: italic 800 14px/1.3 var(--exo); }`)), [])
  assert.deepEqual(lines(uprightExoInCss(`.a { color: red; }\n.b { font-family: "Exo", sans-serif; }`)), [2])
  assert.deepEqual(lines(uprightExoInCss(`.a { font: 700 13px var(--font-exo); }`)), [1])
  assert.deepEqual(lines(uprightExoInCss(`.a { font-family: Exo; font-style: italic; font-style: normal; }`)), [1])
  assert.deepEqual(lines(uprightExoInCss(`@utility t { @apply font-exo text-sm; }`)), [1])
  assert.deepEqual(lines(uprightExoInCss(`@utility t { @apply font-exo italic; }`)), [])
  assert.deepEqual(lines(uprightExoInCss(`/* .a { font-family: Exo } */ .b { color: red }`)), [])
  assert.deepEqual(lines(uprightExoInCss(`@media (x) {\n  .a { font-family: Exo; }\n}`)), [2])
})

test("hex colours of every length are found, anchors and entities are not", () => {
  assert.deepEqual(lines(hexColours("`a #fff\nb #ffff\nc #0900bb\nd #0900bbcc`")), [1, 2, 3, 4])
  assert.deepEqual(lines(hexColours(`<p>url(#og) &#123; id="#section-two" #12345 #ggg</p>`)), [])
})

test("comments and fragment references are not colours", () => {
  assert.deepEqual(lines(hexColours(`// Icons for #318\n/* was #fff */\nconst c = "#fff"`)), [3])
  assert.deepEqual(lines(hexColours(`<use href="#abc" /><a href={"#add"} /><path fill="url(#bad)" />`)), [])
  assert.deepEqual(lines(hexColours(`/* #fff */ .a { color: #0900bb }`, "a.css")), [1])
  assert.deepEqual(lines(hexColours(`<!-- #fff -->\n<path fill="#fff"/>`, "a.svg")), [2])
})

test("CountPill is found by name, not in comments", () => {
  assert.deepEqual(lines(countPills(`import { CountPill } from "x"\n<CountPill />`)), [1, 2])
  assert.deepEqual(lines(countPills(`<CountPills />`)), [])
  assert.deepEqual(lines(countPills(`// CountPill was removed here (#323)\n{/* <CountPill /> */}`)), [])
})

test("route-looks entries marked new are read in any quote style, comments aside", () => {
  const source = `export const looks = {\n  "/staff": "legacy",\n  "/staff/reopenings": /* converted */ "new",\n  '/staff/kit': 'new', // the kit\n  // "/staff/fees": "new",\n}`
  assert.deepEqual(newRoutes(source), ["/staff/reopenings", "/staff/kit"])
  assert.deepEqual(readRouteLooks(source).errors, [])
})

test("route-looks entries the lint cannot read are reported, never skipped", () => {
  assert.match(readRouteLooks(`export const looks = { "/staff/fees": LOOK }`).errors[0].message, /must map to "new" or "legacy", not LOOK/)
  assert.match(readRouteLooks(`export const looks = new Map()`).errors[0].message, /no "\/staff…"/)
  withTree({ "app/staff/route-looks.ts": `export const looks = { "/staff": NEW }`, "app/staff/page.tsx": "" }, (root) => {
    assert.deepEqual(lint(root).map((p) => `${p.file}:${p.line}`), ["app/staff/route-looks.ts:1"])
  })
})

test("lint passes a clean tree and reports file and line", () => {
  withTree(
    {
      "app/tokens.css": ":root { --gf-indigo: #0900bb; }",
      "app/page.tsx": `<h1 className="font-exo italic" />`,
      "components/kit/card.tsx": `<div className="bg-gf-paper shadow-gf-card" />`,
    },
    (root) => assert.deepEqual(lint(root), []),
  )
  withTree(
    {
      "app/page.tsx": `\n<p className="font-exo" />`,
      "components/kit/card.tsx": `const c = "#0900bb"`,
      "components/icons/bell.svg": `<svg><path fill="#fff"/></svg>`,
      "components/staff/old.tsx": `const c = "#0900bb"`,
    },
    (root) =>
      assert.deepEqual(
        lint(root).map((p) => `${p.file}:${p.line}`),
        ["app/page.tsx:2", "components/icons/bell.svg:1", "components/kit/card.tsx:1"],
      ),
  )
})

test("a converted route may hold no hex and no CountPill; its nested routes are their own", () => {
  withTree(
    {
      "app/staff/route-looks.ts": `export const looks = { "/staff/reopenings": "new", "/staff/reopenings/[id]": "legacy" }`,
      "app/staff/reopenings/page.tsx": `<CountPill count={1} />`,
      "app/staff/reopenings/_parts/row.tsx": `const c = "#fff"`,
      "app/staff/reopenings/[id]/page.tsx": `const c = "#fff"; <CountPill />`,
      "app/staff/applicants/page.tsx": `<CountPill />`,
    },
    (root) =>
      assert.deepEqual(
        lint(root).map((p) => `${p.file}:${p.line}`),
        ["app/staff/reopenings/_parts/row.tsx:1", "app/staff/reopenings/page.tsx:1"],
      ),
  )
})

test("a route marked new whose folder is gone is reported", () => {
  withTree({ "app/staff/route-looks.ts": `export const looks = { "/staff/gone": "new" }` }, (root) => {
    assert.match(lint(root)[0].message, /app\/staff\/gone does not exist/)
  })
})

test("the upright Exo allowance holds a count: one more fails, one fewer asks to lower it", () => {
  const [file, { count }] = Object.entries(UPRIGHT_EXO_ALLOWED)[0]
  const upright = `<p className="font-exo" />;\n`
  withTree({ [file]: upright.repeat(count) }, (root) => assert.deepEqual(lint(root), []))
  withTree({ [file]: upright.repeat(count + 1) }, (root) => assert.match(lint(root)[0].message, /at most/))
  withTree({ [file]: upright.repeat(count - 1) }, (root) => assert.match(lint(root)[0].message, /lower UPRIGHT_EXO_ALLOWED/))
})

test("the repository passes", () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
  assert.deepEqual(lint(root), [])
})
