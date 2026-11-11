#!/usr/bin/env node
// Draws the four isometric illustrations of DESIGN.md (Illustrations) into
// public/illustrations/. The geometry is the approved prototype's (version
// 13, wizard.js `ILLO`), copied box for box: change it only with a new
// prototype version the owner has approved.
//
// Run: node scripts/illustrations.mjs. scripts/illustrations.test.mjs fails
// when a committed file differs from what this script writes.

import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// 30° projection: screen x = (X − Y) × 0.866, screen y = (X + Y) × 0.5 − Z.
const pt = (X, Y, Z) => `${((X - Y) * 0.866).toFixed(1)},${((X + Y) * 0.5 - Z).toFixed(1)}`

// A box with its left side, right side and top, each a filled polygon.
const box = (X, Y, Z, w, d, h, top, left, right) =>
  `<polygon points="${pt(X, Y + d, Z + h)} ${pt(X + w, Y + d, Z + h)} ${pt(X + w, Y + d, Z)} ${pt(X, Y + d, Z)}" fill="${left}"/>` +
  `<polygon points="${pt(X + w, Y, Z + h)} ${pt(X + w, Y + d, Z + h)} ${pt(X + w, Y + d, Z)} ${pt(X + w, Y, Z)}" fill="${right}"/>` +
  `<polygon points="${pt(X, Y, Z + h)} ${pt(X + w, Y, Z + h)} ${pt(X + w, Y + d, Z + h)} ${pt(X, Y + d, Z + h)}" fill="${top}"/>`

// A line drawn flat on a top face at height Z.
const line = (points, Z, colour = WH, width = 4) =>
  `<polyline points="${points.map(([x, y]) => pt(x, y, Z)).join(" ")}" fill="none" stroke="${colour}" stroke-width="${width}"/>`

// A part that bobs; `delay` staggers it against the others.
const bob = (delay, body) => `<g class="bob"${delay ? ` style="animation-delay:${delay}ms"` : ""}>${body}</g>`

const LV = "#e0dcf9"
const LV2 = "#cbc5f6"
const LV3 = "#b9b1f2"
const WH = "#fff"
const WHISPER = "#f2f0fc"
const IG = "url(#ig)"
const ID = "#0900bb"
const IN = "#070099"
const OG = "url(#og)"
const OG2 = "#cc6200"
const OG3 = "#b35500"

export const SCENES = {
  // Loading: three slabs and an orange block stacking.
  loading: () =>
    bob(0, box(-24, -24, 0, 48, 48, 6, LV, LV2, LV3)) +
    bob(140, box(-24, -24, 16, 48, 48, 6, WH, WHISPER, LV)) +
    bob(280, box(-24, -24, 32, 48, 48, 6, IG, ID, IN)) +
    bob(420, box(-7, -7, 46, 14, 14, 12, OG, OG2, OG3)),
  // Empty: a tray with a blank sheet floating above it.
  empty: () =>
    box(-28, -28, 0, 56, 56, 18, LV, WH, WHISPER) +
    `<polygon points="${pt(-22, -22, 18)} ${pt(22, -22, 18)} ${pt(22, 22, 18)} ${pt(-22, 22, 18)}" fill="${LV3}"/>` +
    bob(
      0,
      box(-14, -18, 40, 28, 36, 2, WH, LV, LV2) +
        line([[-8, -10], [8, -10]], 42, ID, 2.2) +
        line([[-8, -2], [8, -2]], 42, ID, 2.2) +
        line([[-8, 6], [2, 6]], 42, ID, 2.2),
    ) +
    box(22, -36, 8, 10, 10, 10, OG, OG2, OG3),
  // Finished: an indigo slab with a white tick and two floating blocks.
  finished: () =>
    box(-30, -30, 0, 60, 60, 9, IG, ID, IN) +
    line([[-12, 10], [-2, 10], [-2, -14]], 9, WH, 5.5) +
    bob(0, box(28, -44, 22, 9, 9, 9, OG, OG2, OG3)) +
    bob(300, box(-48, 22, 30, 7, 7, 7, LV, LV2, LV3)),
  // Front desk: a desk with a screen and an orange block.
  "front-desk": () =>
    box(-36, -26, 0, 72, 52, 4, LV, LV2, LV3) +
    box(-26, -8, 4, 52, 22, 24, WH, IG, ID) +
    box(-18, -4, 28, 18, 13, 1.5, WH, LV, LV2) +
    line([[-14, 0], [-4, 0]], 29.5, ID, 2) +
    line([[-14, 4.5], [-8, 4.5]], 29.5, ID, 2) +
    bob(0, box(10, -2, 28, 10, 10, 7, OG, OG2, OG3)),
}

const STYLE =
  ".bob{animation:bob 2200ms cubic-bezier(0.65,0,0.35,1) infinite}" +
  "@keyframes bob{50%{transform:translateY(-5px)}}" +
  "@media (prefers-reduced-motion:reduce){.bob{animation:none}}"

const DEFS =
  '<linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ee7300"/><stop offset="1" stop-color="#ffc48f"/></linearGradient>' +
  '<linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b73ff"/><stop offset="1" stop-color="#0900bb"/></linearGradient>'

// The prototype draws each scene in a -64 -76 128 112 box with overflow
// visible, and Finished's floating blocks reach past its sides. An <img> clips
// at its frame, so the file's frame is 8 units wider on each side;
// components/illustrations/illustration.tsx lays the 128-unit box out at the
// requested width and lets the extra hang over, as the prototype does.
export const FRAME = { x: -72, y: -76, width: 144, height: 112 }

/** One scene as a standalone SVG file: Indigo Night 1.5px outlines, round joins. */
export function svg(name) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}" width="${FRAME.width}" height="${FRAME.height}">` +
    `<style>${STYLE}</style><defs>${DEFS}</defs>` +
    `<g stroke="#03004d" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SCENES[name]()}</g>` +
    "</svg>\n"
  )
}

function main() {
  const dir = join(resolve(fileURLToPath(new URL("..", import.meta.url))), "public", "illustrations")
  for (const name of Object.keys(SCENES)) writeFileSync(join(dir, `${name}.svg`), svg(name))
  console.log(`illustrations: wrote ${Object.keys(SCENES).length} files to public/illustrations`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
