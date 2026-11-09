"use client"

import { useEffect, type RefObject } from "react"

import { prefersReducedMotion } from "./motion"
import "./guided-form.css"

const COLOURS = ["#ee7300", "#0900bb", "#ffb36b", "#6f66ff", "#ee7300", "#0900bb"]
const LIFE = 2600

/**
 * A one-off burst of paper in orange and indigo, 820 ms after mount, from the
 * centre of `originRef` (the success tick) or the top third of the screen.
 * Draws on a fixed, click-through canvas that removes itself. Skipped under
 * reduced motion. Renders nothing.
 */
export function Confetti({ originRef, delay = 820 }: { originRef?: RefObject<HTMLElement | null>; delay?: number }) {
  useEffect(() => {
    if (prefersReducedMotion()) return
    let frame = 0
    let canvas: HTMLCanvasElement | null = null
    const timer = window.setTimeout(() => {
      canvas = document.createElement("canvas")
      const g = canvas.getContext("2d")
      if (!g) return
      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.className = "gf-confetti"
      canvas.setAttribute("aria-hidden", "true")
      canvas.width = w * dpr
      canvas.height = h * dpr
      document.body.appendChild(canvas)
      g.scale(dpr, dpr)
      const r = originRef?.current?.getBoundingClientRect()
      const cx = r ? r.left + r.width / 2 : w / 2
      const cy = r ? r.top + r.height / 2 : h / 3
      const bits = Array.from({ length: 70 }, (_, i) => {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
        const v = 4 + Math.random() * 6
        return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 4 + Math.random() * 4, h: 7 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: COLOURS[i % COLOURS.length], sway: Math.random() * 6 }
      })
      const t0 = performance.now()
      const step = (now: number) => {
        const k = (now - t0) / LIFE
        g.clearRect(0, 0, w, h)
        if (k >= 1) {
          canvas?.remove()
          return
        }
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1
        for (const p of bits) {
          p.vx *= 0.985
          p.vy = p.vy * 0.985 + 0.16
          p.x += p.vx + Math.sin(now / 300 + p.sway) * 0.4
          p.y += p.vy
          p.rot += p.vr
          g.save()
          g.translate(p.x, p.y)
          g.rotate(p.rot)
          g.scale(1, Math.abs(Math.cos(now / 200 + p.sway)))
          g.fillStyle = p.c
          g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
          g.restore()
        }
        frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      canvas?.remove()
    }
  }, [originRef, delay])
  return null
}
