import { SkeletonBlock } from "@/components/kit"

// One re-application while it opens: the way back, the header and the
// student, then the review and the comparison.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading the re-application…</span>
      <SkeletonBlock width={110} height={16} />
      <SkeletonBlock width={220} height={32} />
      <SkeletonBlock width="60%" height={16} />
      <SkeletonBlock height={120} shape="card" />
      <SkeletonBlock height={420} shape="card" />
    </div>
  )
}
