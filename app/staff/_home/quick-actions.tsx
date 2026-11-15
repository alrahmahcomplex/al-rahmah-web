import type { IconName } from "@/components/icons"
import { Card, ListRow } from "@/components/kit"

export type QuickAction = { href: string; icon: IconName; title: string; caption?: string }

/** Home's three shortcuts (#323), each shown only to staff who can open its page. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <Card title="Quick actions" className="hm-qa">
      {actions.map((action) => (
        <ListRow key={action.href} href={action.href} icon={action.icon} title={action.title} caption={action.caption} trailing={false} />
      ))}
    </Card>
  )
}
