"use client"

import { useEffect } from "react"

import { prefersReducedMotion } from "./motion"

// On a phone, the box that gets the caret is brought above the keyboard
// (#511, prototype v54). Space and Enter move the caret to the next name box
// with focus({ preventScroll: true }), so the browser never scrolls it into
// view; with the keyboard open it can sit behind it.

/** A text box: the only fields a keyboard covers. */
function isTextBox(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && !["radio", "checkbox", "button", "submit", "reset", "file", "hidden", "range", "color"].includes(el.type)
}

/** The nearest part of the page that scrolls, or the page itself. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) return at
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

/**
 * Scrolls the box into the part of the screen the keyboard leaves free,
 * below a sticky bar `topInset` tall, when any of it is outside. A box in a
 * list over the page (marked `data-keep-in-view-skip`) is left alone.
 */
export function keepInView(el: Element | null, topInset = 84): void {
  if (!isTextBox(el) || el.closest("[data-keep-in-view-skip]")) return
  const vv = window.visualViewport
  const top = (vv ? vv.offsetTop : 0) + topInset
  const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 16
  const r = el.getBoundingClientRect()
  if (r.top >= top && r.bottom <= bottom) return
  const want = top + Math.max(0, (bottom - top - r.height) * 0.35)
  scrollerOf(el).scrollBy({ top: r.top - want, behavior: prefersReducedMotion() ? "auto" : "smooth" })
}

/**
 * Keeps the focused box in view while the page is mounted: each time a box
 * takes focus, and each time the keyboard opens or closes (the visual
 * viewport resizes). Mount it once per form page.
 */
export function useKeepFocusInView(topInset = 84): void {
  useEffect(() => {
    let timer = 0
    const later = (pick: () => Element | null) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => keepInView(pick(), topInset), 60)
    }
    const onFocus = (event: FocusEvent) => later(() => (document.activeElement === event.target ? (event.target as Element) : null))
    const onResize = () => later(() => document.activeElement)
    document.addEventListener("focusin", onFocus)
    window.visualViewport?.addEventListener("resize", onResize)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("focusin", onFocus)
      window.visualViewport?.removeEventListener("resize", onResize)
    }
  }, [topInset])
}
