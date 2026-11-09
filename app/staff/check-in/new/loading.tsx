import { LogoLoader } from "@/components/brand/logo-loader"
import { Bone, PageSkeleton } from "@/components/staff/page-skeleton"

// Register a student: the progress bar, the step rail and the first step's
// question and fields. The page has no heading row, so the emblem leads the
// question.
export default function Loading() {
  return (
    <PageSkeleton label="the registration form">
      <div className="flex flex-col gap-1.5">
        <Bone className="h-1 w-full rounded-full" />
        <Bone className="h-3 w-20" />
      </div>
      <div className="grid gap-6 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-12">
        <div className="hidden flex-col gap-4 md:flex">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Bone className="size-6 rounded-full" />
              <Bone className="h-3.5 w-28" />
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <LogoLoader size={40} />
            <div className="flex min-w-0 flex-col gap-2">
              <Bone className="h-7 w-72 max-w-full" />
              <Bone className="h-4 w-56 max-w-full" />
            </div>
          </div>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex max-w-md flex-col gap-1.5">
              <Bone className="h-4 w-28" />
              <Bone className="h-10 w-full" />
            </div>
          ))}
          <Bone className="h-10 w-28" />
        </div>
      </div>
    </PageSkeleton>
  )
}
