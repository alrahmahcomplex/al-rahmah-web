import { SkeletonBlock } from "@/components/kit"

import "../lead.css"
import "./history.css"

// A lead's history while it opens: the History heading with the student's
// name and number under it, the card of entries, then the way back.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="lr-page">
      <span className="sr-only">Loading the history…</span>
      <div className="flex flex-col gap-2.5">
        <SkeletonBlock width={160} height={32} />
        <SkeletonBlock width={260} height={16} className="max-w-full" />
      </div>
      <SkeletonBlock height={360} shape="card" className="lh-card" />
      <SkeletonBlock width={208} height={44} shape="pill" />
    </div>
  )
}
