import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton, TableSkeleton } from "@/components/staff/page-skeleton"

// One year's fee schedule: the way back and the heading, the amounts by
// class, then the academic year and seats.
export default function Loading() {
  return (
    <PageSkeleton label="the fee schedule">
      <div className="flex flex-col gap-1">
        <Bone className="h-4 w-24" />
        <HeadingSkeleton width="w-52" />
      </div>
      <TableSkeleton rows={8} cols={4} summary={false} />
      <CardSkeleton lines={2} />
    </PageSkeleton>
  )
}
