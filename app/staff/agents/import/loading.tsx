import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Import agents: the way back and the heading, the file step, earlier
// imports.
export default function Loading() {
  return (
    <PageSkeleton label="the agent import">
      <div className="flex flex-col gap-2">
        <Bone className="h-4 w-32" />
        <HeadingSkeleton width="w-40" subline />
      </div>
      <CardSkeleton lines={3} className="max-w-2xl" />
      <div className="flex max-w-2xl flex-col gap-2">
        <Bone className="h-5 w-32" />
        <Bone className="h-3.5 w-full" />
        <Bone className="h-3.5 w-2/3" />
      </div>
    </PageSkeleton>
  )
}
