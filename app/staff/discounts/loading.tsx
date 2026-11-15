import { SkeletonBlock } from "@/components/kit"

// Discount requests while it opens: the header, then the card of rows.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading discount requests…</span>
      <SkeletonBlock width={240} height={32} />
      <SkeletonBlock width="60%" height={16} />
      <SkeletonBlock height={200} shape="card" />
    </div>
  )
}
