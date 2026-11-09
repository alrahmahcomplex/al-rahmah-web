import { Bone, HeadingSkeleton, PageSkeleton, TableSkeleton } from "@/components/staff/page-skeleton"

// The four rows of filter buttons: Enrollment year, Result, Interview fee,
// Result release.
const FILTER_ROWS = [3, 4, 3, 3]

// Interviews: the filters, then the list.
export default function Loading() {
  return (
    <PageSkeleton label="interviews">
      <HeadingSkeleton width="w-36" />
      <div className="flex flex-col gap-3">
        {FILTER_ROWS.map((count, row) => (
          <div key={row} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="w-32 shrink-0">
              <Bone className="h-3.5 w-24" />
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: count }, (_, index) => (
                <Bone key={index} className={index === 0 ? "h-8 w-16" : "h-8 w-20"} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <TableSkeleton rows={10} cols={9} />
    </PageSkeleton>
  )
}
