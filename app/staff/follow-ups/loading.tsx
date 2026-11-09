import { Bone, HeadingSkeleton, ListSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Follow-ups: Overdue, then Upcoming, each a list of families to call.
export default function Loading() {
  return (
    <PageSkeleton label="follow-ups" className="gap-8">
      <HeadingSkeleton width="w-36" />
      <div className="flex flex-col gap-3">
        <Bone className="h-5 w-24" />
        <ListSkeleton rows={2} lines={4} />
      </div>
      <div className="flex flex-col gap-3">
        <Bone className="h-5 w-24" />
        <ListSkeleton rows={3} lines={4} />
      </div>
    </PageSkeleton>
  )
}
