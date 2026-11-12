import { SkeletonBlock } from "@/components/kit"

// One year's fee schedule while it opens: the way back and the header, the
// amounts' cards, then the academic year and seats.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="sr-only">Loading the fee schedule…</span>
      <SkeletonBlock width={80} height={16} />
      <SkeletonBlock width={280} height={32} />
      <SkeletonBlock width={130} height={36} shape="pill" />
      <SkeletonBlock height={280} shape="card" />
      <SkeletonBlock height={200} shape="card" />
    </div>
  )
}
