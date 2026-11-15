import { SkeletonBlock } from "@/components/kit"

// The four rows of filter pills: Enrollment year, Result, Interview fee,
// Result release.
const FILTER_ROWS = [3, 4, 3, 2]

// Interviews while it opens: the header, the filters, then the table's card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading interviews…</span>
      <SkeletonBlock width={200} height={32} />
      {FILTER_ROWS.map((count, row) => (
        <div key={row} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: count }, (_, index) => (
            <SkeletonBlock key={index} width={index === 0 ? 72 : 96} height={36} shape="pill" />
          ))}
        </div>
      ))}
      <SkeletonBlock width={120} height={16} />
      <SkeletonBlock height={420} shape="card" />
    </div>
  )
}
