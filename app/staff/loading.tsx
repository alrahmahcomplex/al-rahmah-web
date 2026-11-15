import { SkeletonBlock } from "@/components/kit"

import "./_home/home.css"

// Home while it opens (#323): the date, the check-in bar beside Register
// students, then the right column's two stat cards and Quick actions.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="hm">
      <span className="sr-only">Loading Home…</span>
      <SkeletonBlock width={180} height={13} />
      <div className="hm-top">
        <SkeletonBlock height={56} shape="pill" />
        <SkeletonBlock height={56} shape="pill" />
      </div>
      <div className="hm-body">
        <div className="hm-main" />
        <div className="hm-side">
          <SkeletonBlock height={190} shape="card" />
          <SkeletonBlock height={190} shape="card" />
          <SkeletonBlock height={230} shape="card" />
        </div>
      </div>
    </div>
  )
}
