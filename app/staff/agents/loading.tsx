import { SkeletonBlock } from "@/components/kit"

// Marketing Agents while it opens: the header with Import and Add agent, the
// access note, the standard discount, the search and the filters, then the
// list's card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only">Loading Marketing Agents…</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "flex-end" }}>
        <SkeletonBlock width={260} height={32} />
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBlock width={150} height={44} shape="pill" />
          <SkeletonBlock width={120} height={44} shape="pill" />
        </div>
      </div>
      <SkeletonBlock height={64} shape="card" />
      <SkeletonBlock height={60} shape="card" />
      <SkeletonBlock width="min(36rem, 100%)" height={44} shape="pill" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[80, 90, 50, 70, 200, 180, 130, 160].map((width, i) => (
          <SkeletonBlock key={i} width={width} height={32} shape="pill" />
        ))}
      </div>
      <SkeletonBlock height={360} shape="card" />
    </div>
  )
}
