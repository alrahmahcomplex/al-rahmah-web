import { CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Reopening requests: one card per closed lead waiting, oldest first.
export default function Loading() {
  return (
    <PageSkeleton label="reopening requests">
      <HeadingSkeleton width="w-52" subline />
      <div className="flex max-w-3xl flex-col gap-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    </PageSkeleton>
  )
}
