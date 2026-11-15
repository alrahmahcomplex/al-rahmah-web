import { SkeletonBlock } from "@/components/kit"

// Seats while it opens: the header, the year links, then seats by class.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="sr-only">Loading seats…</span>
      <SkeletonBlock width={160} height={32} />
      <div style={{ display: "flex", gap: 8 }}>
        <SkeletonBlock width={56} height={28} />
        <SkeletonBlock width={56} height={28} />
        <SkeletonBlock width={56} height={28} />
      </div>
      <SkeletonBlock height={420} shape="card" />
    </div>
  )
}
