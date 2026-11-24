"use client"

import { useEffect } from "react"

import { prefersReducedMotion } from "./motion"

// On a phone, the box that gets the caret is brought above the keyboard
// (#511, prototype v54). Space and Enter move the caret to the next name box
// with focus({ preventScroll: true }), so the browser never scrolls it into
// view; with the keyboard open it can sit behind it. Chrome's autofill strip
// above the keyboard opens a moment later and can cover a box the browser had
// just scrolled to. It runs on every page (`KeepFocusInView` in app/layout.tsx);
// a form with a taller sticky bar names its height with useKeepFocusInView.

const DEFAULT_INSET = 84
/** Room kept between the box and the keyboard. */
const MARGIN = 16

/** A text box: the only fields a keyboard covers. */
function isTextBox(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && !["radio", "checkbox", "button", "submit", "reset", "file", "hidden", "range", "color"].includes(el.type)
}

/**
 * The nearest part of the page that scrolls, or the page itself. Null for a
 * box inside something fixed over the page (a dialog) that doesn't scroll:
 * scrolling the page behind it would not move the box.
 */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY, position } = getComputedStyle(at)
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) return at
    if (position === "fixed") return null
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

// The pages mounted now, each with the sticky bar height it named, if any.
const mounted: { inset?: number }[] = []

/** The sticky bar height the newest page named, else the default. */
function currentInset(): number {
  for (let i = mounted.length - 1; i >= 0; i--) {
    const inset = mounted[i].inset
    if (inset !== undefined) return inset
  }
  return DEFAULT_INSET
}

/** The part of the screen the keyboard leaves free, below the sticky bar, in the page's fixed coordinates. */
function freeSpace(topInset: number): { top: number; bottom: number } {
  const vv = window.visualViewport
  const top = vv ? vv.offsetTop : 0
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  return { top: top + topInset, bottom: bottom - MARGIN }
}

/** The focused text box inside `root`, if one there should be kept in view. */
export function focusedTextBoxIn(root: Element): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement
  if (!isTextBox(el) || !root.contains(el) || el.closest("[data-keep-in-view-skip]")) return null
  return el
}

/**
 * Corrects a planned scroll (`by` px down) so `box` still shows in the free
 * space once it has run: its foot above the keyboard and, before that, its
 * head below the sticky bar.
 */
export function keepShowingAfter(box: Element, by: number, topInset = currentInset()): number {
  const { top, bottom } = freeSpace(topInset)
  const r = box.getBoundingClientRect()
  let next = by
  if (r.bottom - next > bottom) next = r.bottom - bottom
  if (r.top - next < top) next = r.top - top
  return next
}

/**
 * Scrolls the box into the part of the screen the keyboard leaves free,
 * below a sticky bar `topInset` tall, when any of it is outside. A box in a
 * list over the page (marked `data-keep-in-view-skip`) is left alone.
 */
export function keepInView(el: Element | null, topInset = currentInset()): void {
  if (!isTextBox(el) || el.closest("[data-keep-in-view-skip]")) return
  const area = scrollerOf(el)
  if (!area) return
  const { top, bottom } = freeSpace(topInset)
  const r = el.getBoundingClientRect()
  if (r.top >= top && r.bottom <= bottom) return
  const want = top + Math.max(0, (bottom - top - r.height) * 0.35)
  area.scrollBy({ top: r.top - want, behavior: prefersReducedMotion() ? "auto" : "smooth" })
}

// One set of listeners however many pages mount the hook, so a box is never scrolled twice.
function listen(): () => void {
  let timer = 0
  const later = (pick: () => Element | null) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => keepInView(pick()), 60)
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
}

let stopListening: (() => void) | null = null

/**
 * Keeps the focused box in view while mounted: each time a box takes focus,
 * and each time the keyboard or its autofill strip opens or closes (the
 * visual viewport resizes). The app mounts it once for every page; a form
 * page whose sticky bar is taller than 84px mounts it too, with that height.
 */
export function useKeepFocusInView(topInset?: number): void {
  useEffect(() => {
    const page = { inset: topInset }
    mounted.push(page)
    stopListening ??= listen()
    return () => {
      mounted.splice(mounted.indexOf(page), 1)
      if (mounted.length > 0) return
      stopListening?.()
      stopListening = null
    }
  }, [topInset])
}

/** `useKeepFocusInView` as a part, for the root layout. */
export function KeepFocusInView({ topInset }: { topInset?: number }): null {
  useKeepFocusInView(topInset)
  return null
}
