import { HeadingSkeleton, PageSkeleton, TableSkeleton, ToolbarSkeleton } from "@/components/staff/page-skeleton"

// Marketing Agents: Import and Add agent, the search, the status filters,
// then the list.
export default function Loading() {
  return (
    <PageSkeleton label="Marketing Agents">
      <HeadingSkeleton width="w-52" actions={2} />
      <ToolbarSkeleton search chips={7} />
      <TableSkeleton rows={8} cols={7} />
    </PageSkeleton>
  )
}
