import { CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Discount requests: one card per request, oldest first.
export default function Loading() {
  return (
    <PageSkeleton label="discount requests">
      <HeadingSkeleton width="w-48" subline />
      <div className="flex max-w-3xl flex-col gap-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    </PageSkeleton>
  )
}
