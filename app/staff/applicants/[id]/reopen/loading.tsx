import { SkeletonBlock } from "@/components/kit"

import "../lead.css"

// Request reopening while it opens: the lead record's header, the request
// card, the Student and Parent or guardian cards, then the way back.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="lr-page">
      <span className="sr-only">Loading the reopening request…</span>
      <div className="lr-head">
        <div className="lr-head-who">
          <SkeletonBlock width={48} height={48} shape="pill" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <SkeletonBlock width={280} height={32} className="max-w-full" />
            <SkeletonBlock width={360} height={16} className="max-w-full" />
          </div>
        </div>
      </div>
      <SkeletonBlock height={260} shape="card" />
      <div className="lr-grid">
        <SkeletonBlock height={220} shape="card" />
        <SkeletonBlock height={180} shape="card" />
      </div>
      <SkeletonBlock width={232} height={44} shape="pill" />
    </div>
  )
}
