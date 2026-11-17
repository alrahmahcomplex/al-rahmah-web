import Link from "next/link"

import { Icon, type IconName } from "@/components/icons"
import { Bento } from "@/components/kit"

export type QuickAction = { href: string; icon: IconName; title: string; caption?: string }

/**
 * Home's shortcuts (#323), as prototype v40 draws them: a row of tiles the
 * width of the page, under the chart and the stat cards, in the kit's bento
 * rule, so the tiles a role has fill the row. Each shows only to staff who
 * can open its page.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <nav aria-label="Quick actions" className="hm-qa">
      <Bento columns={3}>
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
      </Bento>
    </nav>
  )
}
