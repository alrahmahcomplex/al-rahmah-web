import { Bone, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Check-in: the question and the one search box.
export default function Loading() {
  return (
    <PageSkeleton label="check-in" className="gap-5">
      <HeadingSkeleton width="w-52" subline />
      <div className="flex max-w-xl gap-2">
        <Bone className="h-10 flex-1" />
        <Bone className="h-10 w-24" />
      </div>
    </PageSkeleton>
  )
}
