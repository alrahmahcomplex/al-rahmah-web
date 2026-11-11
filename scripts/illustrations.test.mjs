import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { FRAME, SCENES, svg } from "./illustrations.mjs"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const dir = join(root, "public", "illustrations")
const names = Object.keys(SCENES)

test("public/illustrations holds exactly the four scenes", () => {
  assert.deepEqual(names.sort(), ["empty", "finished", "front-desk", "loading"])
  assert.deepEqual(readdirSync(dir).sort(), names.map((n) => `${n}.svg`).sort())
})

test("each committed file is what the script draws", () => {
  for (const name of names) assert.equal(readFileSync(join(dir, `${name}.svg`), "utf8"), svg(name), `${name}.svg is stale: run node scripts/illustrations.mjs`)
})

test("each file stays under 8 KB", () => {
  for (const name of names) assert.ok(statSync(join(dir, `${name}.svg`)).size < 8 * 1024, name)
})

test("each scene bobs, and stands still under reduced motion", () => {
  for (const name of names) {
    const file = svg(name)
    assert.match(file, /<g class="bob"/, name)
    assert.match(file, /\.bob\{animation:bob 2200ms [^}]*infinite\}/)
    assert.match(file, /@keyframes bob\{50%\{transform:translateY\(-5px\)\}\}/)
    assert.match(file, /@media \(prefers-reduced-motion:reduce\)\{\.bob\{animation:none\}\}/)
  }
})

test("every part fits inside the file's frame, bob included", () => {
  for (const name of names) {
    const file = svg(name)
    const points = [...file.matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(" ").map((p) => p.split(",").map(Number)))
    const pad = 1 // half the 1.5px outline, rounded up; the thicker lines lie inside the boxes
    for (const [x, y] of points) {
      assert.ok(x - pad >= FRAME.x && x + pad <= FRAME.x + FRAME.width, `${name}: x ${x}`)
      assert.ok(y - pad - 5 >= FRAME.y && y + pad <= FRAME.y + FRAME.height, `${name}: y ${y}`)
    }
  }
})

test("outlines are Indigo Night at 1.5px with round joins", () => {
  for (const name of names) assert.match(svg(name), /<g stroke="#03004d" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">/)
})
