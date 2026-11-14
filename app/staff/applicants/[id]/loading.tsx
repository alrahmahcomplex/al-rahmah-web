import { SkeletonBlock } from "@/components/kit"

import "./lead.css"

// The lead's section tabs: Overview, Interview, School fee, Follow-ups,
// Discounts.
const TABS = [96, 96, 112, 112, 104]

// A lead while it opens: the header (a disc where the student's initials will
// be, the name, the Admission Number line, History and More), the next step,
// the section tabs and two cards.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="lr-page">
      <span className="sr-only">Loading the application…</span>
      <div className="lr-head">
        <div className="lr-head-who">
          <SkeletonBlock width={48} height={48} shape="pill" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <SkeletonBlock width={280} height={32} className="max-w-full" />
            <SkeletonBlock width={360} height={16} className="max-w-full" />
          </div>
        </div>
        <div className="lr-head-act">
          <SkeletonBlock width={104} height={36} shape="pill" />
          <SkeletonBlock width={80} height={36} shape="pill" />
        </div>
      </div>
      <SkeletonBlock height={96} shape="card" />
      <div className="flex flex-wrap gap-2">
        {TABS.map((width, index) => (
          <SkeletonBlock key={index} width={width} height={36} shape="pill" />
        ))}
      </div>
      <div className="lr-grid">
        <SkeletonBlock height={220} shape="card" />
        <SkeletonBlock height={180} shape="card" />
      </div>
    </div>
  )
}
