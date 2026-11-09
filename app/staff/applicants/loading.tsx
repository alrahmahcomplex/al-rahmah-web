import { HeadingSkeleton, PageSkeleton, TableSkeleton, ToolbarSkeleton } from "@/components/staff/page-skeleton"

// Leads: the search box, the three filters, the list.
export default function Loading() {
  return (
    <PageSkeleton label="applicants">
      <HeadingSkeleton width="w-24" />
      <ToolbarSkeleton search fields={3} />
      <TableSkeleton rows={10} cols={6} />
    </PageSkeleton>
  )
}
