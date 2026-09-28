import { ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Result } from "@/lib/services/result"
import type { HistoryEntry } from "@/lib/services/staff-admin"

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// Every staff-and-role change and invite, newest first. Collapsed by default,
// because it answers "who did this?" and is not part of every visit.
export function History({ result }: { result: Result<HistoryEntry[], "unavailable"> }) {
  return (
    <Collapsible className="border-t pt-4">
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group -ml-2.5" />}>
        <ChevronRightIcon data-icon="inline-start" className="transition-transform group-aria-expanded:rotate-90" />
        History
      </CollapsibleTrigger>
      <CollapsibleContent>
        {!result.ok ? (
          <p className="mt-2 text-sm text-destructive">History could not be loaded. Try again in a moment.</p>
        ) : result.data.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol aria-label="History" className="mt-2 flex flex-col divide-y text-sm">
            {result.data.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-2">
                <p>
                  <span className="font-medium">{entry.actor}</span> {entry.summary}
                  <time dateTime={entry.at} className="block text-xs text-muted-foreground sm:ml-2 sm:inline">
                    {WHEN.format(new Date(entry.at))}
                  </time>
                </p>
                {entry.changes.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {entry.changes.map((change) => (
                      <li key={change.field} className="break-words">
                        {change.field}:{" "}
                        {change.from !== null && <>{change.from} → </>}
                        <span className="text-foreground">{change.to ?? "none"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
