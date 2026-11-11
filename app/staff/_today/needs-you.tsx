import { Card, EmptyState, ListRow, Note } from "@/components/kit"
import type { IconName } from "@/components/icons"

import type { QueueRow, QueueRowKey } from "./queue"

const ICONS: Record<QueueRowKey, IconName> = {
  overdue: "followups",
  interviews: "interviews",
  reApplications: "reapps",
  results: "interviews",
  agents: "agents",
  discounts: "discounts",
  reopenings: "reopen",
}

// The work waiting for the signed-in staff member, each row a link to the
// screen it is done on. With nothing waiting, one calm line.
export function NeedsYou({ rows, unavailable }: { rows: QueueRow[]; unavailable: boolean }) {
  return (
    <Card title="Needs you today" titleId="needs-you-heading">
      {rows.length === 0 && unavailable ? (
        <Note tone="bad" className="td-gap">
          What is waiting could not be counted. Try again in a moment.
        </Note>
      ) : rows.length === 0 ? (
        <div data-testid="today-empty">
          <EmptyState title="Nothing is waiting." hint="Families you check in will appear here." />
        </div>
      ) : (
        <ul className="td-rows">
          {rows.map((row) => (
            <li key={row.key} data-testid={`today-${row.key}`}>
              <ListRow href={row.href} icon={ICONS[row.key]} title={row.title} caption={row.detail} />
            </li>
          ))}
        </ul>
      )}
      {unavailable && rows.length > 0 && (
        <Note tone="wait" className="td-gap">
          Some of what is waiting could not be counted. Try again in a moment.
        </Note>
      )}
    </Card>
  )
}
