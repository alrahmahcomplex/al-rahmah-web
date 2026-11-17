import { SkeletonBlock } from "@/components/kit"

// Register students while it opens: the Home button, the header, then the
// task card in its centred column.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
      <span className="sr-only">Loading the registration form…</span>
      <SkeletonBlock width={96} height={36} />
      <SkeletonBlock width={260} height={32} />
      <SkeletonBlock width="50%" height={16} />
      <div style={{ width: "100%", maxWidth: 640 }}>
        <SkeletonBlock height={420} shape="card" />
      </div>
    </div>
  )
}
