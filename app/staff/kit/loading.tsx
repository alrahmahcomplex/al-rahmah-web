import { SkeletonBlock } from "@/components/kit"

import "./kit-page.css"

// The kit page's outline while it opens: the header, then two cards.
export default function Loading() {
  return (
    <div data-kit="" className="kp-stage">
      <div role="status" aria-busy="true" className="kp-page kp-skel">
        <span className="sr-only">Loading Design system…</span>
        <SkeletonBlock width={260} height={32} />
        <SkeletonBlock width="70%" height={16} />
        <div className="kp-ds" style={{ marginTop: 14 }}>
          <SkeletonBlock height={220} shape="card" />
          <SkeletonBlock height={220} shape="card" />
        </div>
      </div>
    </div>
  )
}
