import Link from "next/link"
import type { CSSProperties } from "react"

import { Icon, type IconName } from "@/components/icons"

export type QuickAction = { href: string; icon: IconName; title: string; caption?: string }

/**
 * Home's shortcuts (#323), as prototype v40 draws them: a row of tiles the
 * width of the page, under the chart and the stat cards. Each shows only to
 * staff who can open its page, and the tiles there are share the row.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <nav aria-label="Quick actions" className="hm-qa" style={{ "--n": actions.length } as CSSProperties}>
      {actions.map((action) => (
        <Link key={action.href} href={action.href} className="hm-q">
          <span className="hm-q-disc">
            <Icon name={action.icon} featured />
          </span>
          <span className="hm-q-text">
            <b>{action.title}</b>
            {action.caption && <small>{action.caption}</small>}
          </span>
          <Icon name="right" className="hm-q-chev" />
        </Link>
      ))}
    </nav>
  )
}
