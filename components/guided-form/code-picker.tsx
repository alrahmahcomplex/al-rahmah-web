"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { codeKey, completeCode, filterCodeOptions, sortCodeOptions, type CodeOption } from "./code-list"
import { Icon } from "./icons"
import { CodeBox } from "./names"
import "./guided-form.css"

export type CodePickerProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  /** The codes to list. They are shown Promo codes first, then agent codes, each A to Z. */
  options: readonly CodeOption[]
  /** `loading` while the list is read, `unavailable` when it could not be. The box takes a typed code either way. */
  listState?: "ready" | "loading" | "unavailable"
  placeholder?: string
  "aria-label"?: string
  "aria-describedby"?: string
  invalid?: boolean
}

// The box's inner space: room for the arrow on the right, a little on the left
// so the whole placeholder fits on a phone. The faint completion uses the same.
const LEFT = 14
const RIGHT = 48

/**
 * The Discount code box with its list (owner, 2026-11-19): CodeBox as it
 * is, plus an arrow that opens every listed code under a search box, and a
 * faint completion of the first listed code the typed letters begin. Tab, or
 * → at the end, takes the completion. Typing a code by hand still works; the
 * caller checks it as before.
 */
export function CodePicker({ id, value, onValueChange, options, listState = "ready", invalid, ...aria }: CodePickerProps) {
  const own = useId()
  const boxId = id ?? `${own}-code`
  const listId = `${own}-list`
  const boxRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restRef = useRef<HTMLSpanElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  // Esc hides the completion until the next letter.
  const [dismissed, setDismissed] = useState(false)
  const [restWidth, setRestWidth] = useState(0)

  const sorted = useMemo(() => sortCodeOptions(options), [options])
  const shown = useMemo(() => filterCodeOptions(query, sorted), [query, sorted])
  const completion = focused && !dismissed && !open ? completeCode(value, sorted) : null
  const rest = completion ? completion.slice(value.length) : ""

  // Keep the typed letters where they sit in the centred whole code.
  useLayoutEffect(() => {
    const width = rest && restRef.current ? restRef.current.getBoundingClientRect().width : 0
    setRestWidth((was) => (Math.abs(was - width) < 0.5 ? was : width))
  }, [rest])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setQuery("")
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open])

  // An opened list near the foot of the screen scrolls up into view.
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" })
  }, [open, active, listId])

  function openList() {
    const picked = sorted.findIndex((option) => sameCode(option.code, value))
    setQuery("")
    setActive(Math.max(picked, 0))
    setOpen(true)
    requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
  }

  function close(focusBox = true) {
    setOpen(false)
    setQuery("")
    if (focusBox) boxRef.current?.focus()
  }

  function choose(option: CodeOption) {
    onValueChange(option.code)
    setDismissed(true)
    close()
    requestAnimationFrame(() => boxRef.current?.setSelectionRange(option.code.length, option.code.length))
  }

  function takeCompletion(): boolean {
    if (!completion) return false
    onValueChange(completion)
    requestAnimationFrame(() => boxRef.current?.setSelectionRange(completion.length, completion.length))
    return true
  }

  function onBoxKey(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length
    if ((event.key === "Tab" && !event.shiftKey) || (event.key === "ArrowRight" && atEnd)) {
      if (takeCompletion()) event.preventDefault()
    } else if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault()
      openList()
    } else if (event.key === "Escape" && completion) {
      event.preventDefault()
      setDismissed(true)
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (shown[active]) choose(shown[active])
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (event.key === "Tab") {
      close(false)
    }
  }

  const empty: ReactNode =
    listState === "loading"
      ? "Loading the codes…"
      : listState === "unavailable"
        ? "The list could not be loaded. Type the code in the box."
        : query.trim() !== ""
          ? `No code matches “${query.trim()}”. You can still type the code in the box.`
          : "No Discount codes are in use."

  return (
    // data-popup-open lets a folding parent, such as the kit's GuidedReveal, show the list past its edge.
    <div ref={pickerRef} className={cn("gf-cp", open && "gf-open")} data-popup-open={open ? "" : undefined}>
      <div className="gf-cp-box">
        <div className="gf-cp-ghost" aria-hidden="true">
          {rest && (
            <>
              <span>{value}</span>
              <span ref={restRef} className="gf-cp-rest">
                {rest}
              </span>
            </>
          )}
        </div>
        <CodeBox
          ref={boxRef}
          id={boxId}
          value={value}
          invalid={invalid}
          {...aria}
          role="combobox"
          aria-autocomplete="inline"
          aria-expanded={open}
          aria-controls={listId}
          className="relative bg-transparent"
          style={{ paddingLeft: LEFT, paddingRight: RIGHT + restWidth }}
          onValueChange={(next) => {
            setDismissed(false)
            onValueChange(next)
          }}
          onKeyDown={onBoxKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <button
          type="button"
          className="gf-cp-arrow"
          aria-label={open ? "Hide the Discount codes" : "Show all Discount codes"}
          aria-expanded={open}
          aria-controls={listId}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => (open ? close() : openList())}
        >
          <Icon name="down" />
        </button>
      </div>
      {open && (
        <div ref={panelRef} className="gf-cp-panel">
          <div className="gf-cp-search">
            <Icon name="search" small />
            <input
              ref={searchRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search codes or names"
              aria-label="Search Discount codes"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setActive(0)
              }}
              onKeyDown={onSearchKey}
            />
            {query !== "" && (
              <button
                type="button"
                className="gf-cp-clear"
                aria-label="Clear the search"
                onClick={() => {
                  setQuery("")
                  setActive(0)
                  searchRef.current?.focus()
                }}
              >
                <Icon name="x" small />
              </button>
            )}
          </div>
          <ul id={listId} className="gf-cp-list" role="listbox" aria-label="Discount codes">
            {listState !== "ready" || shown.length === 0 ? (
              <li className="gf-cp-empty" role="presentation">
                {empty}
              </li>
            ) : (
              shown.map((option, i) => {
                const heading =
                  i === 0 || shown[i - 1].kind !== option.kind ? (
                    <li key={`${option.kind}-heading`} className="gf-cp-group" role="presentation">
                      {option.kind === "promo" ? "Promo codes" : "Agent codes"}
                    </li>
                  ) : null
                return [
                  heading,
                  <li
                    key={`${option.kind}-${option.code}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={sameCode(option.code, value)}
                    className={cn("gf-cp-opt", i === active && "gf-on")}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(option)}
                  >
                    <Icon name="check" small />
                    <b>{marked(option.code, query)}</b>
                    <small>{marked(option.detail, query)}</small>
                  </li>,
                ]
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function sameCode(a: string, b: string): boolean {
  return b !== "" && codeKey(a) === codeKey(b)
}

// The searched words underlined where they appear.
function marked(text: string, query: string): ReactNode {
  const words = query.trim()
  const at = words === "" ? -1 : text.toLowerCase().indexOf(words.toLowerCase())
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + words.length)}</mark>
      {text.slice(at + words.length)}
    </>
  )
}
