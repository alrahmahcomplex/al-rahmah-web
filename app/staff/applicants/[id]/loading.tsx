import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// The lead's section tabs: Overview, Interview, School fee, Follow-ups,
// Discounts.
const TABS = ["w-16", "w-16", "w-20", "w-20", "w-16"]

// A lead: the header (the emblem stands where the student's initials will
// be), the next step, the section tabs and two panels.
export default function Loading() {
  return (
    <PageSkeleton label="the application" className="gap-5">
      <HeadingSkeleton width="w-56" subline avatar actions={2} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-l-4 border-l-slate-200 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
          <Bone className="h-5 w-56 max-w-full" />
          <Bone className="h-3.5 w-80 max-w-full" />
        </div>
        <Bone className="h-10 w-36" />
      </div>
      <div className="flex h-10 items-center gap-6 border-b px-3">
        {TABS.map((width, index) => (
          <Bone key={index} className={`h-3.5 ${width}`} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    </PageSkeleton>
  )
}
