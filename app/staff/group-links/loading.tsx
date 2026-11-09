import { Bone, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// WhatsApp groups: the year picker, then the year's saved link and the form.
export default function Loading() {
  return (
    <PageSkeleton label="WhatsApp groups">
      <HeadingSkeleton width="w-48" />
      <Bone className="h-4 w-full max-w-xl" />
      <div className="flex max-w-sm flex-col gap-2">
        <Bone className="h-4 w-28" />
        <div className="flex gap-2">
          <Bone className="h-10 w-28" />
          <Bone className="h-10 w-24" />
        </div>
      </div>
      <div className="flex max-w-xl flex-col gap-3">
        <Bone className="h-5 w-36" />
        <Bone className="h-3.5 w-full" />
        <Bone className="h-3.5 w-64" />
        <Bone className="h-10 w-full" />
      </div>
    </PageSkeleton>
  )
}
