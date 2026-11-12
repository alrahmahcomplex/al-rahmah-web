import type { Result } from "@/lib/services/result"
import type { HistoryEntry } from "@/lib/services/staff-admin"

import { Disclosure } from "../_form-parts/disclosure"

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// Every staff-and-role change and invite, newest first. Collapsed by default,
// because it answers "who did this?" and is not part of every visit.
export function History({ result }: { result: Result<HistoryEntry[], "forbidden" | "unavailable"> }) {
  return (
    <div className="ro-history">
      <Disclosure label="History">
        {!result.ok ? (
          <p className="ro-history-err">History could not be loaded. Try again in a moment.</p>
        ) : result.data.length === 0 ? (
          <p className="ro-plain ro-quiet">No changes yet.</p>
        ) : (
          <ol aria-label="History" className="ro-history-list">
            {result.data.map((entry) => (
              <li key={entry.id}>
                <p>
                  <b>{entry.actor}</b> {entry.summary}
                  <time dateTime={entry.at}>{WHEN.format(new Date(entry.at))}</time>
                </p>
                {entry.changes.length > 0 && (
                  <ul className="ro-changes">
                    {entry.changes.map((change) => (
                      <li key={change.field}>
                        {change.field}: {change.from !== null && <>{change.from} → </>}
                        <span className="ro-to">{change.to ?? "none"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Disclosure>
    </div>
  )
}
