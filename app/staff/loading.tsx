import { Bone, HeadingSkeleton, ListSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Today: the greeting with its two front-desk actions, then what needs you
// beside the latest registrations.
export default function Loading() {
  return (
    <PageSkeleton label="Today">
      <HeadingSkeleton width="w-64" subline actions={2} pill />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.25fr_0.9fr]">
        <div className="flex flex-col gap-2.5">
          <Bone className="h-3 w-28" />
          <ListSkeleton rows={3} lines={2} />
        </div>
        <div className="flex flex-col gap-2.5">
          <Bone className="h-3 w-36" />
          <ListSkeleton rows={5} lines={2} />
        </div>
      </div>
    </PageSkeleton>
  )
}
