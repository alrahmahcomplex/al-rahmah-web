"use client"

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"

import { setLanguage } from "@/app/actions/language"
import { trapTab } from "@/components/guided-form/bottom-sheet"
import { Icon } from "@/components/guided-form/icons"
import { useSwitchInPlace } from "@/components/page-language"
import type { Language } from "@/lib/language"
import type { CachedPublicPath } from "@/lib/language-state"
import { cn } from "@/lib/utils"

import { LANGUAGE_OPTIONS, type BrandCopy } from "./copy"
import "@/components/guided-form/guided-form.css"

/**
 * Makes the menu button pop with an orange ring (`.menubtn.catch`), as when
 * the language card shrinks into it.
 */
export function catchMenuButton(button: HTMLElement | null) {
  if (!button) return
  button.classList.remove("gf-catch")
  void button.offsetWidth
  button.classList.add("gf-catch")
  window.setTimeout(() => button.classList.remove("gf-catch"), 900)
}

export type BrandMenuProps = {
  language: Language
  labels: BrandCopy
  /** When given, the menu offers "Futa fomu yote", which asks once before calling this. */
  onClearForm?: () => void
  /** The 44px menu button, for the language card's balloon and `catchMenuButton`. */
  buttonRef?: RefObject<HTMLButtonElement | null>
  /**
   * On a page served from Vercel's cache, its public address: with JavaScript
   * the switch changes the page in place, and without it the visitor returns
   * there and the new cookie picks the other copy (components/page-language.tsx).
   */
  returnTo?: CachedPublicPath
}

/**
 * The top-right menu: a 44px outlined round button with the three-bar icon,
 * and a small panel with the Kiswahili | English control (it posts to
 * `setLanguage`, so it works before JavaScript loads) and, on pages with a
 * form, the red "clear the whole form" item with its confirm step.
 * Escape and an outside click close it; Tab stays inside while it is open;
 * focus goes back to the button.
 */
export function BrandMenu({ language, labels, onClearForm, buttonRef, returnTo }: BrandMenuProps) {
  const switchInPlace = useSwitchInPlace()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const ownButton = useRef<HTMLButtonElement | null>(null)
  const button = buttonRef ?? ownButton
  const clearItem = useRef<HTMLButtonElement>(null)
  const clearNo = useRef<HTMLButtonElement>(null)

  const close = useCallback((focusButton: boolean) => {
    setOpen(false)
    setConfirming(false)
    if (focusButton) button.current?.focus()
  }, [button])

  // Opening puts focus on the current language.
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close(true)
        return
      }
      if (panel.current) trapTab(event, panel.current)
    }
    const onPointer = (event: MouseEvent) => {
      // A click on "Futa fomu yote" swaps that button for the confirm box
      // before this listener runs, so its target has left the page; that is
      // a click inside the menu, not outside it.
      const path = event.composedPath()
      const target = event.target as Node | null
      if (!wrap.current || path.includes(wrap.current) || (target && !target.isConnected)) return
      close(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("click", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("click", onPointer)
    }
  }, [open, close])

  return (
    <div ref={wrap} className="gf-menuwrap">
      <button
        ref={button}
        type="button"
        className="gf-round gf-menubtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={labels.menu}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <Icon name="menu" />
      </button>
      <div ref={panel} id={menuId} className="gf-menu" role="dialog" aria-modal="false" aria-label={labels.menu} hidden={!open}>
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
          <Icon name="globe" small />
          <span>{labels.language}</span>
        </p>
        <form action={setLanguage} onSubmit={returnTo ? switchInPlace : undefined}>
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
          <div role="group" aria-label={labels.language} className="flex w-full rounded-full border border-blue-600/22 bg-white p-[3px]">
            {LANGUAGE_OPTIONS.map(({ lang, label }) => {
              const current = lang === language
              return (
                <button
                  key={lang}
                  type="submit"
                  name="lang"
                  value={lang}
                  lang={lang}
                  aria-pressed={current}
                  className={cn(
                    "min-h-11 flex-1 rounded-full px-3.5 font-exo text-sm font-bold italic transition-colors outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40",
                    current ? "bg-blue-600 text-white" : "text-blue-600 hover:bg-blue-50",
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </form>
        {onClearForm && (
          <>
            <hr className="my-0.5 w-full border-0 border-t border-blue-600/22" />
            {confirming ? (
              <div className="flex flex-col gap-2.5 rounded-2xl bg-red-50 p-3">
                <p className="m-0 text-sm leading-[1.45] text-slate-800">
                  <b className="mb-0.5 block text-[15px] text-[#c81e1e]">{labels.clearQuestion}</b>
                  <span>{labels.clearBody}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    ref={clearNo}
                    type="button"
                    className="min-h-11 flex-1 rounded-full border-[1.5px] border-blue-600/22 bg-white text-sm font-semibold text-blue-600 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
                    onClick={() => {
                      setConfirming(false)
                      requestAnimationFrame(() => clearItem.current?.focus())
                    }}
                  >
                    {labels.clearNo}
                  </button>
                  <button
                    type="button"
                    className="min-h-11 flex-1 rounded-full border-0 bg-[#c81e1e] text-sm font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
                    onClick={() => {
                      close(false)
                      onClearForm()
                    }}
                  >
                    {labels.clearYes}
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={clearItem}
                type="button"
                className="flex min-h-11 w-full items-center gap-2.5 rounded-[14px] border-0 bg-transparent px-3 text-left text-[15px] font-semibold text-[#c81e1e] outline-none hover:bg-red-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
                onClick={() => {
                  setConfirming(true)
                  requestAnimationFrame(() => clearNo.current?.focus())
                }}
              >
                <Icon name="trash" />
                <span>{labels.clearForm}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
