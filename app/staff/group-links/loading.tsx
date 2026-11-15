import { SkeletonBlock } from "@/components/kit"

// WhatsApp groups while it opens: the heading, the year picker, then the
// year's card with its saved link and the form.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only">Loading WhatsApp groups…</span>
      <SkeletonBlock width={240} height={32} />
      <SkeletonBlock width="min(36rem, 100%)" height={16} />
      <SkeletonBlock width={110} height={16} />
      <div style={{ display: "flex", gap: 8 }}>
        <SkeletonBlock width={112} height={44} shape="pill" />
        <SkeletonBlock width={120} height={44} shape="pill" />
      </div>
      <SkeletonBlock height={300} shape="card" />
    </div>
  )
}
