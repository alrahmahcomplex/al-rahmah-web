import { SkeletonBlock } from "@/components/kit"

// Reopening requests while it opens: the header, then the table's card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading reopening requests…</span>
      <SkeletonBlock width={280} height={32} />
      <SkeletonBlock width="60%" height={16} />
      <SkeletonBlock height={220} shape="card" />
    </div>
  )
}
