import { Bone, HeadingSkeleton, ListSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// The filters: From, To, Who, Area, Record.
const FIELDS = ["w-40", "w-40", "w-56", "w-48", "w-64"]

// Audit: the filters, then the entries.
export default function Loading() {
  return (
    <PageSkeleton label="the audit">
      <HeadingSkeleton width="w-24" subline />
      <div className="flex flex-wrap items-end gap-4">
        {FIELDS.map((width, index) => (
          <div key={index} className={`flex flex-col gap-1.5 ${width}`}>
            <Bone className="h-4 w-12" />
            <Bone className="h-10 w-full" />
          </div>
        ))}
        <div className="flex gap-2">
          <Bone className="h-10 w-20" />
          <Bone className="h-10 w-20" />
        </div>
      </div>
      <Bone className="h-4 w-20" />
      <ListSkeleton rows={8} lines={2} bare />
    </PageSkeleton>
  )
}
