import { prefersReducedMotion } from "@/components/guided-form/motion"

import "./kit.css"

// Our colours only (DESIGN.md, Confetti): orange, indigo and green, each with its light partner.
const COLOURS = ["--gf-orange", "--gf-confetti-peach", "--gf-indigo", "--gf-confetti-violet", "--gf-green", "--gf-confetti-mint"]
// Mixed shapes, strips and waves the most often, as the prototype draws them.
const KINDS = ["strip", "strip", "dot", "tri", "wave", "wave", "curl", "square"] as const
type Kind = (typeof KINDS)[number]
// The tick ends 800ms after the mark appears; this fires the burst if its animationend never comes.
const FALLBACK_MS = 1000
// One frame at 60Hz, the rate the prototype's per-frame numbers assume; a step never counts as more
// than three of them, so a tab coming back from the background does not jump the pieces off screen.
const FRAME_MS = 1000 / 60
const MAX_STEP = 3

type Piece = {
  x: number
  y: number
  vx: number
  vy: number
  g: number
  drag: number
  rot: number
  vr: number
  fl: number
  vf: number
  sw: number
  ph: number
  size: number
  colour: string
  kind: Kind
  life: number
  max: number
}

/**
 * The finish confetti (DESIGN.md, Confetti; prototype v38): once the finish
 * mark's tick has drawn, a ring pulses from the mark and the pieces burst out
 * of its centre, then flutter down: 60 on a phone (under 600px), 85 wider.
 * `from` is the mark; without it, the last finish mark on the screen, or the
 * top third of the window when there is none. The canvas removes itself.
 * Skipped under reduced motion.
 */
export function rainConfetti(from?: Element | null) {
  if (typeof document === "undefined" || prefersReducedMotion()) return
  // instanceof, so a click handler passing its event finds the mark by itself.
  const mark = from instanceof Element ? from : lastVisibleMark()
  if (!mark) {
    burst(window.innerWidth / 2, window.innerHeight / 3)
    return
  }
  let fired = false
  const fire = () => {
    if (fired || !mark.isConnected) return
    fired = true
    mark.removeAttribute("data-burst")
    void (mark as HTMLElement).offsetWidth
    mark.setAttribute("data-burst", "")
    const box = mark.getBoundingClientRect()
    burst(box.left + box.width / 2, box.top + box.height / 2)
  }
  mark.querySelector(".kit-mark-tick")?.addEventListener("animationend", fire, { once: true })
  window.setTimeout(fire, FALLBACK_MS)
}

function lastVisibleMark() {
  const marks = [...document.querySelectorAll<HTMLElement>(".kit-mark")].filter((m) => m.getClientRects().length > 0)
  return marks.at(-1) ?? null
}

function burst(x: number, y: number) {
  const canvas = document.createElement("canvas")
  const g = canvas.getContext("2d")
  if (!g) return
  const w = window.innerWidth
  const h = window.innerHeight
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const small = w < 600
  canvas.className = "kit-cf"
  canvas.setAttribute("aria-hidden", "true")
  canvas.width = w * dpr
  canvas.height = h * dpr
  document.body.appendChild(canvas)
  g.scale(dpr, dpr)

  const root = getComputedStyle(document.documentElement)
  const colours = COLOURS.map((token) => root.getPropertyValue(token).trim())
  const pieces: Piece[] = Array.from({ length: small ? 60 : 85 }, (_, i) => {
    const a = Math.random() * Math.PI * 2
    const speed = (small ? 6 : 8) + Math.random() * (small ? 10 : 15)
    return {
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - (small ? 5 : 6),
      g: 0.16 + Math.random() * 0.08,
      drag: 0.955 + Math.random() * 0.025,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.28,
      fl: Math.random() * Math.PI * 2,
      vf: 0.07 + Math.random() * 0.13,
      sw: Math.random() * Math.PI * 2,
      ph: Math.random() * Math.PI * 2,
      size: 7 + Math.random() * 7,
      colour: colours[i % colours.length],
      kind: KINDS[Math.floor(Math.random() * KINDS.length)],
      // Lifetime in 60Hz frames: 2.7 to 4.5 seconds.
      life: 0,
      max: 160 + Math.random() * 110,
    }
  })

  // The prototype's numbers are per frame at 60Hz. Each frame scales them by the time since the last
  // one (k, in 60Hz frames), so the burst lasts as long on a 30Hz phone as on a 144Hz screen.
  let last: number | undefined
  const frame = (now: number) => {
    const k = last === undefined ? 0 : Math.min(MAX_STEP, (now - last) / FRAME_MS)
    last = now
    g.clearRect(0, 0, w, h)
    let alive = 0
    for (const p of pieces) {
      p.life += k
      if (p.life > p.max || p.y > h + 40) continue
      alive++
      const drag = p.drag ** k
      p.vx *= drag
      p.vy = p.vy * drag + p.g * k
      p.sw += 0.06 * k
      p.x += (p.vx + Math.sin(p.sw) * 0.7) * k
      p.y += p.vy * k
      p.rot += p.vr * k
      p.fl += p.vf * k
      g.save()
      g.globalAlpha = Math.min(1, (p.max - p.life) / 40)
      g.translate(p.x, p.y)
      g.rotate(p.rot)
      g.scale(1, Math.max(0.15, Math.abs(Math.cos(p.fl))))
      draw(g, p)
      g.restore()
    }
    if (alive) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}

function draw(g: CanvasRenderingContext2D, p: Piece) {
  const s = p.size
  g.fillStyle = p.colour
  g.strokeStyle = p.colour
  if (p.kind === "strip") g.fillRect(-s / 2, -s / 5, s, s * 0.4)
  else if (p.kind === "square") g.fillRect(-s / 3, -s / 3, s * 0.66, s * 0.66)
  else if (p.kind === "dot") {
    g.beginPath()
    g.arc(0, 0, s * 0.3, 0, Math.PI * 2)
    g.fill()
  } else if (p.kind === "tri") {
    g.beginPath()
    g.moveTo(0, -s * 0.45)
    g.lineTo(s * 0.42, s * 0.35)
    g.lineTo(-s * 0.42, s * 0.35)
    g.closePath()
    g.fill()
  } else if (p.kind === "wave") {
    g.lineWidth = 2.6
    g.lineCap = "round"
    g.beginPath()
    for (let t = 0; t <= 1.001; t += 0.1) {
      const px = -s + 2 * s * t
      const py = Math.sin(t * Math.PI * 3 + p.ph) * s * 0.32
      if (t === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  } else {
    g.lineWidth = 2.4
    g.lineCap = "round"
    g.beginPath()
    for (let t = 0; t <= 2.6 * Math.PI; t += 0.25) {
      const r = s * 0.12 + t * s * 0.09
      const px = Math.cos(t) * r
      const py = Math.sin(t) * r
      if (t === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  }
}
