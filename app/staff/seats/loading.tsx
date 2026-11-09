import { Bone, HeadingSkeleton, PageSkeleton, TableSkeleton, ToolbarSkeleton } from "@/components/staff/page-skeleton"

// Seats: the year links, then seats by class.
export default function Loading() {
  return (
    <PageSkeleton label="seats">
      <HeadingSkeleton width="w-32" />
      <ToolbarSkeleton chips={3} />
      <div className="flex flex-col gap-2">
        <Bone className="h-5 w-32" />
        <Bone className="h-3.5 w-full max-w-2xl" />
        <TableSkeleton rows={8} cols={3} summary={false} />
      </div>
    </PageSkeleton>
  )
}
