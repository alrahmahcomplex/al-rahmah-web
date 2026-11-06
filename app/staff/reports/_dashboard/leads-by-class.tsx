import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { LeadsByClass } from "@/lib/services/dashboard"

// The Leads by enrollment class table: every class in school order, zeros
// included, and the panel total.
export function LeadsByClassTable({ counts }: { counts: LeadsByClass }) {
  return (
    <div className="flex flex-col gap-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Class</TableHead>
            <TableHead className="text-right">Leads</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {counts.classes.map(({ className, count }) => (
            <TableRow key={className}>
              <TableCell className="py-1.5">{className}</TableCell>
              <TableCell
                className={`py-1.5 text-right tabular-nums ${count === 0 ? "text-muted-foreground" : "text-slate-900"}`}
                data-testid={`classes-count-${className}`}
              >
                {count.toLocaleString("en-GB")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="py-1.5 font-medium">Total</TableCell>
            <TableCell className="py-1.5 text-right font-semibold tabular-nums" data-testid="classes-total">
              {counts.total.toLocaleString("en-GB")}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-xs text-muted-foreground">Counted by the date the lead was created</p>
    </div>
  )
}
