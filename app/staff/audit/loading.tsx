import { SkeletonBlock } from "@/components/kit"

import "./audit.css"

// The filters: From, To, Who, Area, Record.
const FIELDS = ["au-w-date", "au-w-date", "au-w-who", "au-w-area", "au-w-record"]

// Audit while it opens: the title and its line, the filters, then the entries' card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="au-page">
      <span className="sr-only">Loading the audit…</span>
      <SkeletonBlock width={120} height={32} />
      <SkeletonBlock width="60%" height={16} />
      <div className="au-filters">
        {FIELDS.map((width, index) => (
          <div key={index} className={width}>
            <SkeletonBlock width={48} height={14} />
            <SkeletonBlock height={40} shape="pill" className="mt-1.5" />
          </div>
        ))}
        <div className="au-actions">
          <SkeletonBlock width={80} height={36} shape="pill" />
          <SkeletonBlock width={80} height={36} shape="pill" />
        </div>
      </div>
      <SkeletonBlock width={80} height={14} />
      <SkeletonBlock height={480} shape="card" />
    </div>
  )
}
