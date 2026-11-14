import { SkeletonBlock } from "@/components/kit"

// Fee schedule while it opens: the header, the card of enrollment years, then
// New schedule.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="sr-only">Loading fee schedules…</span>
      <SkeletonBlock width={220} height={32} />
      <SkeletonBlock height={200} shape="card" />
      <SkeletonBlock height={150} shape="card" />
    </div>
  )
}
