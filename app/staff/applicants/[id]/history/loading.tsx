import { Bone, HeadingSkeleton, ListSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// A lead's history: the heading with the student's name, then the entries.
export default function Loading() {
  return (
    <PageSkeleton label="the history">
      <HeadingSkeleton width="w-28" subline />
      <ListSkeleton rows={6} lines={2} bare />
      <Bone className="h-10 w-36" />
    </PageSkeleton>
  )
}
