import { Bone, CardSkeleton, HeadingSkeleton, PageSkeleton } from "@/components/staff/page-skeleton"

// One count tile: title, period, the number, what it counts.
function Tile() {
  return (
    <div className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <Bone className="h-4 w-32" />
      <Bone className="h-3 w-40" />
      <Bone className="mt-1 h-8 w-16" />
      <Bone className="h-3 w-36" />
    </div>
  )
}

// Reports: the five count tiles, Leads by enrollment class in the right-hand
// column, Seats by class across the bottom.
export default function Loading() {
  return (
    <PageSkeleton label="reports">
      <HeadingSkeleton width="w-28" />
      <div className="flex flex-col gap-3">
        <Bone className="h-5 w-24" />
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Tile key={index} />
          ))}
          <CardSkeleton lines={9} className="lg:col-start-3 lg:row-span-3 lg:row-start-1" />
          <CardSkeleton lines={5} className="sm:col-span-2 lg:col-span-3" />
        </div>
      </div>
    </PageSkeleton>
  )
}
