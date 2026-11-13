import { SkeletonBlock } from "@/components/kit"

// Import agents while it opens: the way back and the heading, the template
// and file steps, then earlier imports.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only">Loading the agent import…</span>
      <SkeletonBlock width={130} height={16} />
      <SkeletonBlock width={220} height={32} />
      <SkeletonBlock width="min(36rem, 100%)" height={16} />
      <SkeletonBlock height={260} shape="card" />
      <SkeletonBlock height={180} shape="card" />
      <SkeletonBlock height={120} shape="card" />
    </div>
  )
}
