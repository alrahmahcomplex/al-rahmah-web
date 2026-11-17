import { Card, Note, SkeletonBlock } from "@/components/kit"
import type { Permission } from "@/lib/permissions"
import type { FullClass } from "@/lib/services/home-activity"
import { createClient } from "@/utils/supabase/server"

import { activityScreenPage } from "./activity-data"
import { ActivityList } from "./activity-list"
import "./activity.css"

/**
 * Home's Activity log card (#406): the first page, read as this staff member.
 * Nothing shows when the log is empty, or for a role that sees no kind of
 * row; a failed read says so in Home's usual words.
 */
export async function ActivityLog({ permissions, today, full }: { permissions: readonly Permission[]; today: string; full: FullClass[] }) {
  const supabase = await createClient()
  const first = await activityScreenPage(supabase, { page: 1, permissions, today, full })
  if (!first.ok) {
    if (first.error === "forbidden") return null
    return <Note tone="bad">The Activity log could not be loaded. Try again in a moment.</Note>
  }
  if (first.data.total === 0) return null
  return <ActivityList first={first.data} />
}

/** The card's shape while the first page loads. */
export function ActivitySkeleton() {
  return (
    <Card title="Activity log" className="hm-al" aria-busy="true">
      <div className="al-skel">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} height={44} />
        ))}
      </div>
    </Card>
  )
}
