"use client"

import { Dialog } from "@base-ui/react/dialog"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react"

import { RoundButton, Toaster } from "@/components/kit"

import { currentNavHref } from "../navigation"
import { SIDEBAR_RAIL_COOKIE, SIDEBAR_WIDTH_COOKIE, clearedSidebarCookie, sidebarCookie } from "../shell-cookies"
import type { ShellProps } from "../shell-types"
import "./new-shell.css"
import { rememberScroll, savedScroll } from "./scroll-memory"
import { SidebarBoundary, SidebarContent } from "./sidebar"
import {
  FIRST_WIDTH,
  KEY_STEP,
  SIDEBAR_BASE,
  clampWidth,
  sidebarLimits,
  titleSize,
  type SidebarLimits,
} from "./sidebar-width"
import { Bell, PersonMenu, TopBarSearch } from "./top-bar-parts"

const PHONE = "(max-width: 860px)"
// A row's side padding, the gap after its icon and the icon (new-shell.css).
const ROW_PADDING = 10
const ROW_GAP = 10
const ICON = 16
// Before the fonts are measured: where the title starts and its width at 14px.
const TITLE_LEFT = 50
const TITLE_WIDTH_GUESS = 132

let canvas: CanvasRenderingContext2D | null = null

type Parts = {
  root: HTMLDivElement
  aside: HTMLElement
  name: HTMLDivElement
  stage: HTMLDivElement
  scroll: HTMLDivElement
  page: HTMLElement
}

/** Measures the open sidebar's limits and the brand title, or null when the sidebar is not on screen (a phone). */
function measure(parts: Parts): { limits: SidebarLimits; titleLeft: number; titleWidth: number } | null {
  const { root, aside, name, stage, scroll, page } = parts
  if (!aside.getClientRects().length) return null
  canvas ??= document.createElement("canvas").getContext("2d")
  let longest = 0
  aside.querySelectorAll<HTMLElement>(".ns-link").forEach((link) => {
    const label = link.querySelector<HTMLElement>("[data-label]")?.dataset.label ?? ""
    const style = getComputedStyle(link)
    if (!canvas) return
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    longest = Math.max(longest, canvas.measureText(label).width)
  })
  const title = name.querySelector("b")
  const titleFont = title ? parseFloat(getComputedStyle(title).fontSize) : 0
  const titleWidth = titleFont ? (name.getBoundingClientRect().width * 14) / titleFont : TITLE_WIDTH_GUESS
  const limits = sidebarLimits({
    rowPadding: ROW_PADDING,
    rowGap: ROW_GAP,
    iconSize: ICON,
    longestLabel: longest,
    framePadding: parseFloat(getComputedStyle(root).paddingLeft) || 16,
    titleLeft: name.offsetLeft || TITLE_LEFT,
    titleWidth,
    pagePadding: parseFloat(getComputedStyle(scroll).paddingLeft) || 0,
    pageMax: parseFloat(getComputedStyle(page).maxWidth) || Number.MAX_SAFE_INTEGER,
    stageAtBase: stage.clientWidth + (aside.getBoundingClientRect().width - SIDEBAR_BASE),
  })
  return { limits, titleLeft: name.offsetLeft || TITLE_LEFT, titleWidth }
}

/**
 * The stage's scrollbar, drawn in the white gutter right of the stage: the
 * stage's own bar is hidden. It shows only when the page can scroll, follows
 * the scroll once per frame, and takes presses and drags. Not on a touch
 * screen, where the stage scrolls natively.
 */
function OutsideScrollbar({ scrollRef, pageRef }: { scrollRef: RefObject<HTMLDivElement | null>; pageRef: RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const scroll = scrollRef.current
    const page = pageRef.current
    const bar = barRef.current
    const thumb = thumbRef.current
    if (!scroll || !page || !bar || !thumb || matchMedia("(pointer: coarse)").matches) return
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
    scroll.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(scroll)
    observer.observe(page)
    sync()
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      observer.disconnect()
    }
  }, [scrollRef, pageRef])

  function press(event: PointerEvent<HTMLDivElement>) {
    const scroll = scrollRef.current
    const bar = barRef.current
    const thumb = thumbRef.current
    if (!scroll || !bar || !thumb) return
    const travel = bar.clientHeight - thumb.offsetHeight
    const range = scroll.scrollHeight - scroll.clientHeight
    if (travel <= 0) return
    // A press on the track jumps there, then the drag carries on from that spot.
    if (event.target !== thumb) {
      const at = (event.clientY - bar.getBoundingClientRect().top - thumb.offsetHeight / 2) / travel
      scroll.scrollTop = range * Math.min(1, Math.max(0, at))
    }
    const start = event.clientY
    const from = scroll.scrollTop
    bar.setPointerCapture(event.pointerId)
    bar.setAttribute("data-drag", "")
    event.preventDefault()
    const move = (e: globalThis.PointerEvent) => {
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

  return (
    <div ref={barRef} className="ns-vbar" aria-hidden="true" onPointerDown={press}>
      <i ref={thumbRef} />
    </div>
  )
}

/**
 * The new staff shell (DESIGN.md, The staff shell): the sidebar, the top bar
 * in the white frame, and the rounded stage holding the page. From 861px the
 * sidebar folds to its icons and can be dragged wider; up to 860px it is a
 * drawer opened from the Menu button.
 */
export function NewShell({ items, person, bell, folded: foldedAtFirst, sidebarWidth, canSearch, children }: ShellProps) {
  const pathname = usePathname()
  const current = currentNavHref(pathname, items.map((item) => item.href))

  const [folded, setFolded] = useState(foldedAtFirst)
  const [drawer, setDrawer] = useState(false)
  // The open width; null keeps the sidebar at its narrowest, which is measured.
  const [chosen, setChosen] = useState<number | null>(sidebarWidth)
  const [width, setWidth] = useState(sidebarWidth ?? FIRST_WIDTH)
  const [title, setTitle] = useState(() => titleSize(sidebarWidth ?? FIRST_WIDTH, TITLE_LEFT, TITLE_WIDTH_GUESS))
  const [limits, setLimits] = useState<SidebarLimits | null>(null)
  const [resizing, setResizing] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const measured = useRef<ReturnType<typeof measure>>(null)

  const parts = (): Parts | null => {
    const [root, aside, name, stage, scroll, page] = [rootRef.current, asideRef.current, nameRef.current, stageRef.current, scrollRef.current, pageRef.current]
    return root && aside && name && stage && scroll && page ? { root, aside, name, stage, scroll, page } : null
  }

  /** Sets the open width within the measured limits; `remember` writes the cookie. */
  const apply = useCallback((next: number | null, remember?: "keep" | "clear") => {
    const found = measured.current
    if (!found) return
    const value = clampWidth(next ?? found.limits.min, found.limits)
    setWidth(value)
    setTitle(titleSize(value, found.titleLeft, found.titleWidth))
    if (remember === "keep") {
      setChosen(value)
      document.cookie = sidebarCookie(SIDEBAR_WIDTH_COOKIE, String(value))
    } else if (remember === "clear") {
      setChosen(null)
      document.cookie = clearedSidebarCookie(SIDEBAR_WIDTH_COOKIE)
    }
  }, [])

  // The limits depend on the labels (the current one is wider), the fonts and
  // the window, so they are measured again whenever one of those changes.
  const chosenRef = useRef(chosen)
  useEffect(() => {
    chosenRef.current = chosen
  }, [chosen])
  useLayoutEffect(() => {
    const remeasure = () => {
      const found = parts() && measure(parts()!)
      if (!found) return
      measured.current = found
      setLimits(found.limits)
      apply(chosenRef.current)
    }
    remeasure()
    window.addEventListener("resize", remeasure)
    let live = true
    document.fonts?.ready.then(() => live && remeasure())
    return () => {
      live = false
      window.removeEventListener("resize", remeasure)
    }
  }, [pathname, folded, apply])

  // The drawer belongs to phones: widening the window past 860px closes it.
  useEffect(() => {
    const query = matchMedia(PHONE)
    const close = () => {
      if (!query.matches) setDrawer(false)
    }
    query.addEventListener("change", close)
    return () => query.removeEventListener("change", close)
  }, [])

  // Each history entry keeps its own scroll position: a new page starts at
  // the top, Back returns to where it was. After a navigation the stage takes
  // focus, so the keyboard scrolls the new page. Runs in the layout phase,
  // before any scroll event of the new page can be saved under its entry.
  const firstPage = useRef(true)
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const target = savedScroll() ?? 0
    let frame = 0
    let tries = 0
    const place = () => {
      scroll.scrollTop = target
      if (scroll.scrollTop < target - 1 && tries++ < 60) frame = requestAnimationFrame(place)
    }
    place()
    if (firstPage.current) firstPage.current = false
    else scroll.focus({ preventScroll: true })
    return () => cancelAnimationFrame(frame)
  }, [pathname])
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    let frame = 0
    const save = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          rememberScroll(scroll.scrollTop)
        })
    }
    scroll.addEventListener("scroll", save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener("scroll", save)
    }
  }, [])

  function toggle() {
    const next = !folded
    setFolded(next)
    document.cookie = sidebarCookie(SIDEBAR_RAIL_COOKIE, next ? "1" : "0")
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget
    const aside = asideRef.current
    if (!aside || event.button !== 0) return
    const start = event.clientX
    const from = aside.getBoundingClientRect().width
    let last = from
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    event.preventDefault()
    const move = (e: globalThis.PointerEvent) => {
      last = from + e.clientX - start
      apply(last)
    }
    const up = () => {
      setResizing(false)
      apply(last, "keep")
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  }

  function resizeByKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!limits) return
    const to = { ArrowLeft: width - KEY_STEP, ArrowRight: width + KEY_STEP, Home: limits.min, End: limits.max }[event.key]
    if (to === undefined) return
    event.preventDefault()
    if (event.key === "Home") apply(null, "clear")
    else apply(to, "keep")
  }

  const style = { "--ns-open": `${width}px`, "--ns-title": `${title.toFixed(2)}px` } as CSSProperties

  return (
    <div
      ref={rootRef}
      data-shell="new"
      data-staff-shell=""
      data-folded={folded ? "" : undefined}
      data-resizing={resizing ? "" : undefined}
      className="ns"
      style={style}
    >
      <aside ref={asideRef} id="staff-sidebar" aria-label="Sidebar" className="ns-sb">
        <SidebarBoundary items={items}>
          <SidebarContent items={items} current={current} folded={folded} nameRef={nameRef} />
        </SidebarBoundary>
      </aside>

      <div className="ns-main">
        <header className="ns-tb">
          <Dialog.Root open={drawer} onOpenChange={(next) => setDrawer(next)}>
            <Dialog.Trigger render={<RoundButton icon="menu" label="Open the menu" size={40} className="ns-menu" />} />
            <Dialog.Portal>
              <Dialog.Backdrop className="ns-drawer-back" />
              <Dialog.Popup aria-label="Menu" data-shell="new" className="ns-drawer">
                <SidebarBoundary items={items}>
                  <SidebarContent items={items} current={current} onChoose={() => setDrawer(false)} />
                </SidebarBoundary>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <RoundButton
            icon="panel"
            label="Fold or open the sidebar"
            size={40}
            className="ns-tog"
            aria-pressed={!folded}
            aria-controls="staff-sidebar"
            onClick={toggle}
          />
          {canSearch && <TopBarSearch />}
          <span className="ns-spacer" />
          {bell && <Bell pending={bell.pending} />}
          <PersonMenu person={person} />
        </header>

        <div ref={stageRef} className="ns-stage">
          <div ref={scrollRef} className="ns-scroll" tabIndex={-1}>
            <main ref={pageRef} className="ns-page">
              {children}
            </main>
          </div>
        </div>
        <OutsideScrollbar scrollRef={scrollRef} pageRef={pageRef} />
        {!folded && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the sidebar. Arrow keys move it, double-click resets it."
            aria-controls="staff-sidebar"
            aria-valuenow={width}
            aria-valuemin={limits?.min}
            aria-valuemax={limits?.max}
            aria-valuetext={`${width} pixels wide`}
            tabIndex={0}
            className="ns-rz"
            data-drag={resizing ? "" : undefined}
            onPointerDown={startResize}
            onDoubleClick={() => apply(null, "clear")}
            onKeyDown={resizeByKey}
          />
        )}
      </div>
      <Toaster />
    </div>
  )
}
