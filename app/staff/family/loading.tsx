import { SkeletonBlock } from "@/components/kit"

// The Family page while it opens: Back, the header, then the students' cards beside the custodians and fees.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading the family…</span>
      <SkeletonBlock width={96} height={36} />
      <SkeletonBlock width={320} height={32} />
      <SkeletonBlock width="50%" height={16} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(280px, 0.9fr)", gap: 18 }}>
        <SkeletonBlock height={420} shape="card" />
        <SkeletonBlock height={260} shape="card" />
      </div>
    </div>
  )
}
