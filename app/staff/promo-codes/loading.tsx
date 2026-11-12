import { SkeletonBlock } from "@/components/kit"

// Promo codes while it opens: the heading with its line and New Promo code,
// then the codes' card.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only">Loading Promo codes…</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonBlock width={200} height={32} />
          <SkeletonBlock width="min(28rem, 80vw)" height={16} />
        </div>
        <SkeletonBlock width={170} height={44} shape="pill" />
      </div>
      <SkeletonBlock height={280} shape="card" />
    </div>
  )
}
