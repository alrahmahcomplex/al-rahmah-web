import { SkeletonBlock } from "@/components/kit"

import "./roles.css"

// Staff and roles while it opens: the title, then the role rail beside the chosen role.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <span className="sr-only">Loading staff and roles…</span>
      <SkeletonBlock width={240} height={32} />
      <div className="ro-grid">
        <SkeletonBlock height={260} shape="card" />
        <SkeletonBlock height={560} shape="card" />
      </div>
    </div>
  )
}
