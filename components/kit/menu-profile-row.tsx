"use client"

import type { ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import "./kit.css"

export type MenuProfileRowProps = {
  initials: string
  name: string
  subtitle: string
  onClick?: () => void
  className?: string
}

/**
 * Profile row inside the account menu (prototype v5, #539): indigo initials
 * circle, Exo italic name over monospace subtitle (such as the Discount code),
 * and a right chevron.
 */
export function MenuProfileRow({ initials, name, subtitle, onClick, className }: MenuProfileRowProps) {
  return (
    <button type="button" role="menuitem" className={cn("kit-mprof", className)} onClick={onClick}>
      <i className="kit-mprof-av" aria-hidden="true">
        {initials}
      </i>
      <span className="kit-mprof-text">
        <b>{name}</b>
        <small>{subtitle}</small>
      </span>
      <Icon name="right" size={18} />
    </button>
  )
}

/**
 * Large indigo initials circle beside a heading, for the Profile sheet header.
 */
export function ProfileHeader({ initials, title }: { initials: string; title: ReactNode }) {
  return (
    <span className="kit-mprof-head">
      <i className="kit-mprof-av" data-size="lg" aria-hidden="true">
        {initials}
      </i>
      <span>{title}</span>
    </span>
  )
}
