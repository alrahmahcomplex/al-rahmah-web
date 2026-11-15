import { SkeletonBlock } from "@/components/kit"

// Re-applications while it opens: the header, the reviewed switch, then the
// table's card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading re-applications…</span>
      <SkeletonBlock width={260} height={32} />
      <SkeletonBlock width="50%" height={16} />
      <SkeletonBlock width={140} height={36} shape="pill" />
      <SkeletonBlock height={260} shape="card" />
    </div>
  )
}
