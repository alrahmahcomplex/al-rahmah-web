import { HeadingSkeleton, PageSkeleton, TableSkeleton } from "@/components/staff/page-skeleton"

// Promo codes: the heading with its line and New Promo code, then the codes.
export default function Loading() {
  return (
    <PageSkeleton label="Promo codes">
      <HeadingSkeleton width="w-36" subline actions={1} />
      <TableSkeleton rows={5} cols={6} summary={false} />
    </PageSkeleton>
  )
}
