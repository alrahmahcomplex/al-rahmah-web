"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Icon } from "@/components/icons"
import { ButtonLink } from "@/components/kit"

const LABEL = "Register students"
const FOLD_MS = 420
const UNFOLD_MS = 380
// Below this width the moving button shows its plus alone.
const NARROW = 150

type Box = { x: number; y: number; w: number; h: number }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Register students (#323). When its place scrolls up out of view it folds
 * into a round orange plus in the stage's right gutter (bottom right on a
 * phone), and unfolds back into place when its place returns. Under reduced
 * motion it swaps without moving.
 */
export function RegisterButton({ href }: { href: string }) {
  const placeRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLAnchorElement>(null)
  const [stage, setStage] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setStage(placeRef.current?.closest<HTMLElement>(".ns-stage") ?? null)
  }, [])

  useEffect(() => {
    const place = placeRef.current
    const fab = fabRef.current
    const scroller = place?.closest<HTMLElement>("[data-stage-scroll]")
    if (!place || !fab || !stage || !scroller) return

    let folded = false
    let frame = 0
    const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const boxOf = (el: Element): Box => {
      const s = stage.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
    }
    const put = (box: Box) => {
      Object.assign(fab.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, right: "auto", bottom: "auto" })
      fab.toggleAttribute("data-narrow", box.w < NARROW)
    }
    const release = () => {
      for (const key of ["left", "top", "width", "height", "right", "bottom"] as const) fab.style[key] = ""
      fab.removeAttribute("data-narrow")
    }
    const fly = (from: Box, to: () => Box, ms: number, done: () => void) => {
      cancelAnimationFrame(frame)
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms)
        const e = easeOut(t)
        const end = to()
        put({ x: from.x + (end.x - from.x) * e, y: from.y + (end.y - from.y) * e, w: from.w + (end.w - from.w) * e, h: from.h + (end.h - from.h) * e })
        if (t < 1) frame = requestAnimationFrame(step)
        else done()
      }
      frame = requestAnimationFrame(step)
    }

    const fold = () => {
      if (folded) return
      folded = true
      const from = fab.hidden ? boxOf(place) : boxOf(fab)
      fab.hidden = false
      place.style.visibility = "hidden"
      release()
      fab.setAttribute("data-folded", "")
      if (still()) return
      const end = boxOf(fab)
      fab.removeAttribute("data-folded")
      put(from)
      fly(from, () => end, FOLD_MS, () => {
        release()
        fab.setAttribute("data-folded", "")
      })
    }
    const unfold = () => {
      if (!folded) return
      folded = false
      const done = () => {
        cancelAnimationFrame(frame)
        fab.hidden = true
        release()
        fab.removeAttribute("data-folded")
        place.style.visibility = ""
      }
      if (still()) return done()
      const from = boxOf(fab)
      fab.removeAttribute("data-folded")
      put(from)
      fly(from, () => boxOf(place), UNFOLD_MS, done)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const above = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)
        if (entry.intersectionRatio >= 0.99) unfold()
        else if (above && entry.intersectionRatio < 0.5) fold()
      },
      { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 0.99, 1] },
    )
    observer.observe(place)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      place.style.visibility = ""
    }
  }, [stage])

  return (
    <>
      <div ref={placeRef} className="hm-reg">
        <ButtonLink href={href} icon="plus">
          {LABEL}
        </ButtonLink>
      </div>
      {stage &&
        createPortal(
          <Link ref={fabRef} href={href} className="hm-fab" aria-label={LABEL} hidden>
            <Icon name="plus" />
            <span>{LABEL}</span>
          </Link>,
          stage,
        )}
    </>
  )
}
