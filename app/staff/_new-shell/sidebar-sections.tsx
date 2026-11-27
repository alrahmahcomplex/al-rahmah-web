"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type MouseEvent } from "react"

import { Icon } from "@/components/icons"

import type { ShellSectionGroup } from "../shell-types"

/**
 * A page's sections under its row in the sidebar (DESIGN.md, The sidebar;
 * design site, prototype v6). The groups open one at a time. A section is a
 * link to the block with its id on the page: pressing it scrolls the stage
 * there. While the stage scrolls, the section on screen is marked current
 * and its group opens. Hidden while the sidebar is folded (new-shell.css).
 */
export function SidebarSections({ id, groups, onChoose }: { id: string; groups: ShellSectionGroup[]; onChoose?: () => void }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(groups[0]?.name ?? "")
  // Nothing is marked until a section is on the page: on another page none is.
  const [current, setCurrent] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const marked = useRef("")
  // A jump scrolls the stage; until it settles, the scroll does not move the mark.
  const jumping = useRef(0)

  useEffect(() => {
    const stage = document.querySelector<HTMLElement>("[data-stage-scroll]")
    if (!stage) return
    const ids = groups.flatMap((group) => group.sections.map((section) => section.id))
    let frame = 0
    const follow = () => {
      frame = 0
      if (jumping.current) return
      const blocks = ids.flatMap((sectionId) => {
        const block = document.getElementById(sectionId)
        return block && block.getClientRects().length ? [[sectionId, block] as const] : []
      })
      if (blocks.length === 0) {
        marked.current = ""
        setCurrent("")
        return
      }
      const line = stage.getBoundingClientRect().top + 90
      let found = blocks[0][0]
      for (const [sectionId, block] of blocks) if (block.getBoundingClientRect().top <= line) found = sectionId
      // At the end of the page the last sections can't reach the top: the last one on screen is current.
      if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4) {
        const bottom = stage.getBoundingClientRect().bottom
        const shown = blocks.filter(([, block]) => block.getBoundingClientRect().top < bottom)
        found = shown[shown.length - 1]?.[0] ?? found
      }
      mark(found)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(follow)
    }
    stage.addEventListener("scroll", schedule, { passive: true })
    // Once for the page as it opens, after its blocks are drawn.
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      stage.removeEventListener("scroll", schedule)
    }
    // The groups come from a fixed list; mark only reads state setters. A new page is looked at again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, pathname])

  function mark(sectionId: string) {
    // Only a change of section moves anything: a group the person folded stays folded while they read on.
    if (marked.current === sectionId) return
    marked.current = sectionId
    setCurrent(sectionId)
    const group = groups.find((g) => g.sections.some((section) => section.id === sectionId))
    if (group) setOpen(group.name)
    // Keep the marked row in sight when the list is taller than the sidebar.
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(sectionId)}"]`)
      row?.scrollIntoView({ block: "nearest" })
    })
  }

  function jump(event: MouseEvent<HTMLAnchorElement>, sectionId: string) {
    const block = document.getElementById(sectionId)
    if (!block) return
    event.preventDefault()
    window.clearTimeout(jumping.current)
    jumping.current = window.setTimeout(() => (jumping.current = 0), 800)
    mark(sectionId)
    history.replaceState(history.state, "", `#${sectionId}`)
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("rm")
    block.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" })
    block.focus({ preventScroll: true })
    onChoose?.()
  }

  return (
    <div ref={listRef} id={id} className="ns-sub">
      {groups.map((group) => {
        const isOpen = open === group.name
        const listId = `${id}-${group.name.toLowerCase().replaceAll(" ", "-")}`
        return (
          <div key={group.name} className="ns-sub-g">
            <button type="button" className="ns-sub-h" aria-expanded={isOpen} aria-controls={listId} onClick={() => setOpen(isOpen ? "" : group.name)}>
              <Icon name="down" size={16} />
              {group.name}
            </button>
            <ul id={listId} className="ns-sub-list" hidden={!isOpen}>
              {group.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="ns-sub-link"
                    data-section={section.id}
                    aria-current={current === section.id ? "location" : undefined}
                    onClick={(event) => jump(event, section.id)}
                  >
                    <span>{section.label}</span>
                    {section.badge && <em>{section.badge}</em>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
