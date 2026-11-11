"use client"

import Image from "next/image"
import Link from "next/link"
import { Component, type ReactNode, type Ref } from "react"

import { Icon } from "@/components/icons"

import { groupNav } from "../navigation"
import type { ShellItem } from "../shell-types"

type SidebarProps = {
  items: ShellItem[]
  current: string | undefined
  folded?: boolean
  /** Called when an entry is chosen, so the phone drawer can close. */
  onChoose?: () => void
  /** The brand title, which the width code measures. */
  nameRef?: Ref<HTMLDivElement>
}

/**
 * The sidebar's contents (DESIGN.md, The sidebar): the logo with "Al-Rahmah
 * Complex" over "Admissions Portal", then every entry the staff member may
 * see, in its group. No counts: the bell is the only one (The One Pip Rule).
 */
export function SidebarContent({ items, current, folded = false, onChoose, nameRef }: SidebarProps) {
  return (
    <>
      <div className="ns-head">
        <Image className="ns-logo" src="/brand/logo-round.png" alt="" width={36} height={36} priority />
        <div ref={nameRef} className="ns-name">
          <b>Al-Rahmah Complex</b>
          <small>Admissions Portal</small>
        </div>
      </div>
      <nav aria-label="Staff" className="ns-nav">
        {groupNav(items).map((group) => [
          <p key={group.name} className="ns-group">
            <span>{group.name}</span>
          </p>,
          ...group.entries.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="ns-link"
              data-icon-host=""
              aria-current={item.href === current ? "page" : undefined}
              // Folded, the label is out of sight: the tooltip names the icon.
              title={folded ? item.label : undefined}
              onClick={onChoose}
            >
              <Icon name={item.iconName} size={16} />
              <span className="ns-label" data-label={item.label}>
                <span className="ns-roll">
                  {item.label}
                  <span className="ns-copy" aria-hidden="true">
                    {item.label}
                  </span>
                </span>
              </span>
            </Link>
          )),
        ])}
      </nav>
    </>
  )
}

/** If the sidebar fails to draw, a plain list of the same links stands in, so every page stays reachable. */
export class SidebarBoundary extends Component<{ items: ShellItem[]; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <nav aria-label="Staff">
        <ul className="ns-plain">
          {this.props.items.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    )
  }
}
