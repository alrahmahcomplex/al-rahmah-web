import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// One re-application: the way back, the heading and the student, then the
// review and the form's answers.
export default function Loading() {
  return (
    <PageSkeleton label="the re-application">
      <div className="flex flex-col gap-2">
        <Bone className="h-4 w-28" />
        <HeadingSkeleton width="w-40" subline />
      </div>
      <CardSkeleton lines={2} />
      <CardSkeleton lines={6} />
    </PageSkeleton>
  )
}
