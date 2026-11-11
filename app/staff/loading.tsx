import { SkeletonBlock } from "@/components/kit"

import "./_today/today.css"

// Today while it opens: the centred greeting with its date line and the two
// front-desk actions, then the cards for what needs you and the latest
// registrations.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="td-narrow td-loading">
      <span className="sr-only">Loading Today…</span>
      <SkeletonBlock width={340} height={40} />
      <SkeletonBlock width="70%" height={16} />
      <div className="td-loading-act">
        <SkeletonBlock width={190} height={44} shape="pill" />
        <SkeletonBlock width={190} height={44} shape="pill" />
      </div>
      <SkeletonBlock height={220} shape="card" />
      <SkeletonBlock height={340} shape="card" />
    </div>
  )
}
