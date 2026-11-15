import { SkeletonBlock } from "@/components/kit"

// Applicants while it opens: the header, then the card with its pill row and
// table.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="sr-only">Loading applicants…</span>
      <SkeletonBlock width={200} height={32} />
      <SkeletonBlock width="40%" height={16} />
      <SkeletonBlock height={520} shape="card" />
    </div>
  )
}
