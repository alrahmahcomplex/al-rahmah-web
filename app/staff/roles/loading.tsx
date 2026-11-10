import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// Staff and roles: the role rail beside the chosen role.
export default function Loading() {
  return (
    <PageSkeleton label="staff and roles" className="gap-4">
      <HeadingSkeleton width="w-44" />
      <div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 4 }, (_, index) => (
            <Bone key={index} className="h-10 w-full" />
          ))}
        </div>
        <CardSkeleton lines={8} />
      </div>
    </PageSkeleton>
  )
}
