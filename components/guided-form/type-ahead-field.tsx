"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

import { Icon } from "./icons"
import { prefersReducedMotion } from "./motion"
import { completion, exactly, restOf, search, startsWith, takesCompletion, type TypeAheadOption } from "./type-ahead"
import "./guided-form.css"

export type TypeAheadLabels = {
  /** The box's name for a screen reader, e.g. "Region". */
  field: string
  /** Inside the empty box, e.g. "Type or choose a region". */
  placeholder: string
  /** The arrow's name, e.g. "Show all regions". */
  showAll: string
  /** The list's search box, e.g. "Search regions". */
  search: string
  /** The list's name, e.g. "Regions". */
  list: string
  /** The line when the search finds nothing. */
  none: (query: string) => ReactNode
}

export type TypeAheadFieldProps = {
  id?: string
  /** The options, in the order the list shows them. */
  options: readonly TypeAheadOption[]
  /** The option shown first with a line under it, such as "Outside Tanzania (Other Country)". */
  pinned?: string
  /** The picked option's value, or "" while nothing on the list is typed. */
  value: string
  /** Called with the option's value when the box holds a whole option, and "" when it stops holding one. `how`: typed, taken with a key, or picked from the list. */
  onValueChange: (value: string, how: "type" | "key" | "pick") => void
  /** Drawn inside the box on the left: a pin, a globe or the picked country's flag. */
  lead?: (value: string) => ReactNode
  /** Drawn before each option in the list, such as a flag. */
  optionLead?: (value: string) => ReactNode
  labels: TypeAheadLabels
  invalid?: boolean
  "aria-describedby"?: string
  /** The smaller box, for a sheet. */
  compact?: boolean
  className?: string
}

// How tall the list may be: at most 380px, and never past 60% of the screen.
const listHeight = () => Math.min(380, Math.round(window.innerHeight * 0.6))
// What a phone keyboard opening makes room for again: the search box and about three rows.
const LIST_FLOOR = 180

/** The nearest part of the page that scrolls: a sheet, the staff stage, or the window. */
function scroller(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(".gf-sheet, [data-stage-scroll]") ?? ((document.scrollingElement ?? document.documentElement) as HTMLElement)
}

/** How much of the scroll area's top stays covered once the box scrolls up: the sticky progress bar of the form the box is in, and a small gap. */
function topCover(box: HTMLElement, area: HTMLElement): number {
  for (let at = box.parentElement; at; at = at.parentElement) {
    const bar = at.querySelector<HTMLElement>(":scope > .gf-bar-row")
    if (bar) return bar.offsetHeight + 8
    if (at === area) break
  }
  return 8
}

const TABBABLE = "a[href], button, input, select, textarea, [tabindex]"

/** Moves focus to the field after the box, or the one before it: where Tab or Shift+Tab would go from the box itself. */
function focusBeside(box: HTMLElement | null, backwards: boolean) {
  if (!box) return
  const stops = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el === box) return true
    if (el.tabIndex < 0 || el.hasAttribute("disabled") || el.closest("[inert], [hidden], .gf-ta-panel")) return false
    if (!(el instanceof HTMLInputElement)) return true
    if (el.type === "hidden") return false
    // A radio group is one stop: its checked radio, or any of them when none is.
    if (el.type !== "radio" || el.checked) return true
    return ![...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((r) => r.name === el.name && r.form === el.form && r.checked)
  })
  const next = stops[stops.indexOf(box) + (backwards ? -1 : 1)]
  ;(next ?? box).focus()
}

/**
 * A box that takes one option from a list (#511, prototype v53). Typing
 * shows the best match as faint text after the letters; Right arrow at the
 * end, Tab or Enter takes it, and Space does when only one option fits. The
 * arrow opens the list below the box, over the page, with a search box on
 * top that works the same way. Only a whole option counts: anything else
 * typed leaves `value` empty, so the caller can ask for one from the list.
 */
export function TypeAheadField({
  id,
  options,
  pinned,
  value,
  onValueChange,
  lead,
  optionLead,
  labels,
  invalid,
  compact,
  className,
  ...aria
}: TypeAheadFieldProps) {
  const own = useId()
  const boxId = id ?? `${own}-box`
  const listId = `${own}-list`
  const wrapRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLInputElement>(null)
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? ""
  const [text, setText] = useState(() => labelOf(value))
  const [focused, setFocused] = useState(false)
  // Esc hides the faint match until the next letter.
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)

  // A value set from outside (a draft, Start over) shows its label. One this
  // box sent itself, such as "" while a picked name is edited, keeps the text.
  const [shownValue, setShownValue] = useState(value)
  const [sent, setSent] = useState<string | null>(null)
  if (shownValue !== value) {
    setShownValue(value)
    if (value !== sent && exactly(options, text)?.value !== value) setText(labelOf(value))
    setSent(null)
  }
  const send = (next: string, how: "type" | "key" | "pick") => {
    setSent(next)
    onValueChange(next, how)
  }

  const match = focused && !dismissed && !open ? completion(options, text) : null
  const rest = match ? restOf(text, match.label) : ""

  function typed(next: string) {
    setText(next)
    setDismissed(false)
    const exact = exactly(options, next)
    if ((exact?.value ?? "") !== value) send(exact?.value ?? "", "type")
  }

  function take(option: TypeAheadOption, how: "key" | "pick") {
    setText(option.label)
    setDismissed(true)
    if (option.value !== value || how === "pick") send(option.value, how)
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    const box = event.currentTarget
    if (match) {
      const caretAtEnd = box.selectionStart === box.value.length && box.selectionEnd === box.value.length
      if (takesCompletion(event.key, { shift: event.shiftKey, caretAtEnd, fits: startsWith(options, text).length })) {
        if (event.key !== "Tab") event.preventDefault()
        take(match, "key")
        return
      }
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
    } else if (event.key === "Escape" && match) {
      event.preventDefault()
      setDismissed(true)
    } else if (event.key === "Enter") {
      // Enter in the box never sends the form while a list answer is half typed.
      if (!exactly(options, text)) event.preventDefault()
    }
  }

  return (
    <div ref={wrapRef} className={cn("gf-ta", compact && "gf-ta-md", open && "gf-open", className)}>
      {lead && (
        <span className="gf-ta-lead" aria-hidden="true">
          {lead(value)}
        </span>
      )}
      <div className={cn("gf-ta-ghost", lead && "gf-ta-led")} aria-hidden="true">
        {rest && (
          <>
            <span className="gf-ta-typed">{text}</span>
            <span className="gf-ta-rest">{rest}</span>
          </>
        )}
      </div>
      {/* The faint match is drawn, not typed into the box, so a screen reader hears it here before Tab takes it. */}
      <span className="sr-only" aria-live="polite" data-ta-suggestion="">
        {match ? match.label : ""}
      </span>
      <input
        ref={boxRef}
        id={boxId}
        type="text"
        className={cn("gf-ta-in", lead && "gf-ta-led")}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={labels.field}
        aria-invalid={invalid || undefined}
        aria-describedby={aria["aria-describedby"]}
        placeholder={labels.placeholder}
        value={text}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="next"
        onChange={(event) => typed(event.currentTarget.value)}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          // A whole option typed in other capitals is shown in the list's spelling.
          const exact = exactly(options, text)
          if (exact && exact.label !== text) setText(exact.label)
        }}
      />
      <button
        type="button"
        className="gf-ta-arrow"
        tabIndex={-1}
        aria-label={labels.showAll}
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false)
            boxRef.current?.focus({ preventScroll: true })
          } else setOpen(true)
        }}
      >
        <Icon name="down" small />
      </button>
      {open && (
        <TypeAheadList
          anchor={wrapRef}
          listId={listId}
          options={options}
          pinned={pinned}
          value={value}
          optionLead={optionLead}
          labels={labels}
          onPick={(option) => {
            setOpen(false)
            take(option, "pick")
            boxRef.current?.focus({ preventScroll: true })
          }}
          onClose={(focusBox) => {
            setOpen(false)
            if (focusBox) boxRef.current?.focus({ preventScroll: true })
          }}
          onLeave={(option, backwards) => {
            setOpen(false)
            if (option) take(option, "pick")
            focusBeside(boxRef.current, backwards)
          }}
        />
      )}
    </div>
  )
}

type ListProps = {
  anchor: React.RefObject<HTMLDivElement | null>
  listId: string
  options: readonly TypeAheadOption[]
  pinned?: string
  value: string
  optionLead?: (value: string) => ReactNode
  labels: TypeAheadLabels
  onPick: (option: TypeAheadOption) => void
  onClose: (focusBox: boolean) => void
  /** Tab or Shift+Tab in the search: close, take the faint match when Tab had one, and move on from the box in that direction. */
  onLeave: (option: TypeAheadOption | null, backwards: boolean) => void
}

/**
 * The open list: fixed below the box, over the page, never above it (owner,
 * #511: "Open Downward as an Overlay"). Opening first scrolls the box up so
 * the list has room; when the page is too short to scroll that far, room is
 * added at its foot while the list is open. When a phone keyboard opens, the
 * box scrolls up again, as far as the form's sticky bar, to keep the search
 * box and about three rows; the list is never taller than the room left
 * below the box, so every row can be reached by scrolling inside it.
 */
function TypeAheadList({ anchor, listId, options, pinned, value, optionLead, labels, onPick, onClose, onLeave }: ListProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const shown = useMemo(() => search(options, query), [options, query])
  const match = completion(shown, query)
  const rest = match ? restOf(query, match.label) : ""
  const picked = shown.findIndex((o) => o.value === value)
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const at = Math.min(active, Math.max(0, shown.length - 1))

  // Scroll the box up, add room if needed, then place the list.
  useLayoutEffect(() => {
    const box = anchor.current
    if (!box) return
    const area = scroller(box)
    const isWindow = area === (document.scrollingElement ?? document.documentElement)
    const want = listHeight()
    const padWas = area.style.paddingBottom
    const calm = prefersReducedMotion()
    // The part of the screen a phone keyboard leaves free: the visual viewport, in the page's fixed coordinates.
    const visible = () => {
      const vv = window.visualViewport
      return vv ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height } : { top: 0, bottom: window.innerHeight }
    }
    // Scrolls the box up until `need` px of list fit below it, as far as the room above allows; returns how far.
    const makeRoom = (need: number) => {
      const v = visible()
      const areaRect = isWindow ? v : area.getBoundingClientRect()
      const r0 = box.getBoundingClientRect()
      const lack = r0.bottom + 8 + need - (Math.min(areaRect.bottom, v.bottom) - 12)
      const room = Math.max(0, r0.top - (Math.max(areaRect.top, v.top) + topCover(box, area)))
      const move = Math.max(0, Math.min(lack, room))
      const left = area.scrollHeight - area.clientHeight - area.scrollTop
      if (move > left) area.style.paddingBottom = `${parseFloat(getComputedStyle(area).paddingBottom) + move - left + 8}px`
      if (move > 1) area.scrollBy({ top: move, behavior: calm ? "auto" : "smooth" })
      return move
    }
    const put = () => {
      const v = visible()
      const r = box.getBoundingClientRect()
      if (r.bottom < v.top || r.top > v.bottom) return onClose(false)
      // Never past the visible space: a taller list would put its last rows behind the keyboard.
      setPlace({ left: r.left, width: r.width, top: r.bottom + 6, maxHeight: Math.max(0, Math.min(want, v.bottom - r.bottom - 18)) })
    }
    let timer = 0
    const later = (moved: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(put, moved > 1 && !calm ? 360 : 0)
    }
    later(makeRoom(want))
    // The keyboard opening or closing: make room for at least the floor again, then place the list.
    const onViewport = () => {
      const v = visible()
      const r = box.getBoundingClientRect()
      later(v.bottom - r.bottom - 18 < Math.min(want, LIST_FLOOR) ? makeRoom(LIST_FLOOR) : 0)
    }
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) put()
    }
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", put)
    window.visualViewport?.addEventListener("resize", onViewport)
    window.visualViewport?.addEventListener("scroll", put)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", put)
      window.visualViewport?.removeEventListener("resize", onViewport)
      window.visualViewport?.removeEventListener("scroll", put)
      area.style.paddingBottom = padWas
    }
    // Placed once per opening; scrolling and resizing place it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A press outside the list and the box closes it.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const t = event.target as Node
      if (!panelRef.current?.contains(t) && !anchor.current?.contains(t)) onClose(false)
    }
    document.addEventListener("pointerdown", away, true)
    return () => document.removeEventListener("pointerdown", away, true)
  }, [anchor, onClose])

  useEffect(() => {
    if (place) searchRef.current?.focus({ preventScroll: true })
  }, [place])

  useEffect(() => {
    const row = document.getElementById(`${listId}-${at}`)
    const list = listRef.current
    if (!row || !list) return
    const top = row.offsetTop - list.offsetTop
    if (top < list.scrollTop) list.scrollTop = top - 6
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight + 6
  }, [at, listId, place])

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    // Tab leaves the list for the next field, taking the faint match on the way; Shift+Tab goes back and takes nothing.
    if (event.key === "Tab") {
      event.preventDefault()
      onLeave(!event.shiftKey && match ? match : null, event.shiftKey)
      return
    }
    // Enter picks the highlighted option below, which starts on the faint match and moves with the arrows.
    const input = event.currentTarget
    const caretAtEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length
    if (event.key !== "Enter" && match && takesCompletion(event.key, { shift: event.shiftKey, caretAtEnd, fits: startsWith(shown, query).length })) {
      event.preventDefault()
      onPick(match)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive(Math.min(shown.length - 1, at + 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive(Math.max(0, at - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (shown[at]) onPick(shown[at])
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      className="gf-ta-panel"
      data-keep-in-view-skip=""
      style={place ? { left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight } : { visibility: "hidden" }}
    >
      <div className="gf-ta-search">
        <Icon name="search" small />
        <div className="gf-ta-ghost" aria-hidden="true">
          {rest && (
            <>
              <span className="gf-ta-typed">{query}</span>
              <span className="gf-ta-rest">{rest}</span>
            </>
          )}
        </div>
        <input
          ref={searchRef}
          type="text"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[at] ? `${listId}-${at}` : undefined}
          aria-label={labels.search}
          placeholder={labels.search}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            const next = event.currentTarget.value
            setQuery(next)
            const found = search(options, next)
            const first = completion(found, next)
            setActive(first ? found.indexOf(first) : 0)
          }}
          onKeyDown={onKey}
        />
      </div>
      <div ref={listRef} id={listId} className="gf-ta-list" role="listbox" aria-label={labels.list}>
        {shown.length === 0 ? (
          <p className="gf-ta-none">{labels.none(query.trim())}</p>
        ) : (
          shown.map((o, i) => (
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === picked}
              className={cn("gf-ta-opt", i === at && "gf-on", o.value === pinned && "gf-pin")}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => i !== at && setActive(i)}
              onClick={() => onPick(o)}
            >
              {optionLead && <span className="gf-ta-olead">{optionLead(o.value)}</span>}
              <span className="gf-ta-nm">{o.label}</span>
              <Icon name="check" small />
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
