import { SkeletonBlock } from "@/components/kit"

// Follow-ups while it opens: the header, then the Overdue and Upcoming cards.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="sr-only">Loading follow-ups…</span>
      <SkeletonBlock width={200} height={32} />
      <SkeletonBlock height={220} shape="card" />
      <SkeletonBlock height={300} shape="card" />
    </div>
  )
}
