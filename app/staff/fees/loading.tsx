import { Bone, HeadingSkeleton, ListSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Fee schedule: one row per Enrollment year, then New schedule.
export default function Loading() {
  return (
    <PageSkeleton label="fee schedules">
      <HeadingSkeleton width="w-40" />
      <ListSkeleton rows={3} lines={2} />
      <div className="flex max-w-sm flex-col gap-2">
        <Bone className="h-5 w-32" />
        <Bone className="h-4 w-28" />
        <div className="flex gap-2">
          <Bone className="h-10 w-28" />
          <Bone className="h-10 w-24" />
        </div>
      </div>
    </PageSkeleton>
  )
}
