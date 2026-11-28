"use client"

import { useEffect, useRef, type RefObject } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

/**
 * The app's scrollbar (DESIGN.md, The staff shell, Outside scrollbar): a
 * thin, light, round bar with no arrows, drawn outside what it scrolls,
 * whose own bar is hidden. The stage's sits in the white gutter right of the
 * stage; a filling card's sits just outside the card's right edge. It shows
 * only while there is more to scroll, follows the scroll once per frame, and
 * takes presses and drags. Not on a touch screen, where the finger scrolls.
 *
 * Place it beside the scrolling element, inside a positioned parent; the
 * `className` sets where it sits.
 */
export function ScrollBar({ target, className }: { target: RefObject<HTMLElement | null>; className?: string }) {
  const barRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const scroll = target.current
    const bar = barRef.current
    const thumb = thumbRef.current
    if (!scroll || !bar || !thumb) return
    if (typeof matchMedia !== "function" || typeof ResizeObserver !== "function" || matchMedia("(pointer: coarse)").matches) return

    let frame = 0
    const sync = () => {
      frame = 0
      const height = bar.clientHeight
      const range = scroll.scrollHeight - scroll.clientHeight
      if (range < 2 || height < 40) {
        bar.removeAttribute("data-on")
        return
      }
      bar.setAttribute("data-on", "")
      const size = Math.max(36, (height * scroll.clientHeight) / scroll.scrollHeight)
      thumb.style.height = `${size}px`
      thumb.style.transform = `translateY(${((height - size) * scroll.scrollTop) / range}px)`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }

    // A press on the track jumps there, then the drag carries on from that spot.
    const press = (event: PointerEvent) => {
      const travel = bar.clientHeight - thumb.offsetHeight
      const range = scroll.scrollHeight - scroll.clientHeight
      if (travel <= 0) return
      if (event.target !== thumb) {
        const at = (event.clientY - bar.getBoundingClientRect().top - thumb.offsetHeight / 2) / travel
        scroll.scrollTop = range * Math.min(1, Math.max(0, at))
      }
      const start = event.clientY
      const from = scroll.scrollTop
      bar.setPointerCapture(event.pointerId)
      bar.setAttribute("data-drag", "")
      event.preventDefault()
      const move = (e: PointerEvent) => {
        scroll.scrollTop = from + ((e.clientY - start) * range) / travel
      }
      const up = () => {
        bar.removeAttribute("data-drag")
        bar.removeEventListener("pointermove", move)
        bar.removeEventListener("pointerup", up)
        bar.removeEventListener("pointercancel", up)
      }
      bar.addEventListener("pointermove", move)
      bar.addEventListener("pointerup", up)
      bar.addEventListener("pointercancel", up)
    }

    // The content's height changes without the scrolling element's: watch
    // each child too, and the children that come and go.
    const sizes = new ResizeObserver(schedule)
    const watch = () => {
      sizes.disconnect()
      sizes.observe(scroll)
      for (const child of Array.from(scroll.children)) sizes.observe(child)
      schedule()
    }
    const children = new MutationObserver(watch)
    children.observe(scroll, { childList: true })
    scroll.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    bar.addEventListener("pointerdown", press)
    watch()
    sync()
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      bar.removeEventListener("pointerdown", press)
      sizes.disconnect()
      children.disconnect()
    }
  }, [target])

  return (
    <div ref={barRef} className={cn("kit-vbar", className)} aria-hidden="true">
      <i ref={thumbRef} />
    </div>
  )
}
