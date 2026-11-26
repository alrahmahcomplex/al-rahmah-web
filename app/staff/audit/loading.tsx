import { SkeletonBlock } from "@/components/kit"

import "./audit.css"

// The filters: From, To, Who, Area, Record.
const FIELDS = ["au-f au-f-date", "au-f au-f-date", "au-f au-f-who", "au-f au-f-area", "au-f au-f-rec"]

// Audit while it opens: the title, the filter row, then the table card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="au-page">
      <span className="sr-only">Loading the audit…</span>
      <SkeletonBlock width={120} height={32} />
      <div className="au-filters">
        {FIELDS.map((cls, index) => (
          <div key={index} className={cls}>
            <SkeletonBlock width={48} height={14} />
            <SkeletonBlock height={44} shape="pill" />
          </div>
        ))}
        <div className="au-actions">
          <SkeletonBlock width={88} height={44} shape="pill" />
          <SkeletonBlock width={44} height={44} shape="pill" />
        </div>
      </div>
      <SkeletonBlock height={480} shape="card" />
    </div>
  )
}
