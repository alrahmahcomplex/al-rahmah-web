import { SkeletonBlock } from "@/components/kit"

import "./reports.css"

// Reports while it opens: the title, the Dashboard heading, the five count
// cards with Applicants by enrollment class in the right-hand column, and
// Seats by class across the bottom.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="rp-dash">
      <span className="sr-only">Loading reports…</span>
      <SkeletonBlock width={160} height={32} />
      <SkeletonBlock width={110} height={18} />
      <div className="rp-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} height={168} shape="card" />
        ))}
        <SkeletonBlock height={520} shape="card" className="rp-side" />
        <SkeletonBlock height={300} shape="card" className="rp-wide" />
      </div>
    </div>
  )
}
