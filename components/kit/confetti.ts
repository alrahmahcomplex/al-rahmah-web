import { prefersReducedMotion } from "@/components/guided-form/motion"

import "./kit.css"

const COLOURS = ["--gf-orange", "--gf-indigo", "--gf-confetti-peach", "--gf-confetti-violet"]
const PIECES = 46

/**
 * The staff registration rain (DESIGN.md, Confetti): 46 pieces fall from the
 * top of the window for 1.7s, then the layer removes itself. Skipped under
 * reduced motion. The Admission form keeps its own burst
 * (components/guided-form/confetti.tsx).
 */
export function rainConfetti() {
  if (typeof document === "undefined" || prefersReducedMotion()) return
  const layer = document.createElement("div")
  layer.className = "kit-cf"
  layer.setAttribute("aria-hidden", "true")
  for (let i = 0; i < PIECES; i++) {
    const piece = document.createElement("i")
    piece.style.left = `${Math.random() * 100}%`
    piece.style.background = `var(${COLOURS[i % COLOURS.length]})`
    piece.style.setProperty("--x", `${Math.round(Math.random() * 240 - 120)}px`)
    piece.style.setProperty("--r", `${Math.round(Math.random() * 900 - 450)}deg`)
    piece.style.animationDelay = `${Math.round(Math.random() * 380)}ms`
    layer.appendChild(piece)
  }
  document.body.appendChild(layer)
  window.setTimeout(() => layer.remove(), 2400)
}
