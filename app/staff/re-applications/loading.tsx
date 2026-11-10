import { HeadingSkeleton, PageSkeleton, TableSkeleton, ToolbarSkeleton } from "@/components/staff/page-skeleton"

// Re-applications: the reviewed/unreviewed switch, then the queue.
export default function Loading() {
  return (
    <PageSkeleton label="re-applications">
      <HeadingSkeleton width="w-44" subline />
      <ToolbarSkeleton chips={1} />
      <TableSkeleton rows={6} cols={5} />
    </PageSkeleton>
  )
}
