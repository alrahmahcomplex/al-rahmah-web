import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Request reopening: the lead's summary with the request form, then the way
// back.
export default function Loading() {
  return (
    <PageSkeleton label="the reopening request">
      <HeadingSkeleton width="w-56" subline avatar />
      <CardSkeleton lines={4} className="max-w-xl" />
      <Bone className="h-10 w-36" />
    </PageSkeleton>
  )
}
