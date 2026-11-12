import { Note } from "@/components/kit"
import { getPreFormOneTick } from "@/lib/services/pre-form-one"
import { createClient } from "@/utils/supabase/server"

import { PRE_FORM_ONE_NOT_APPLYING } from "./pre-form-one-outcome"
import { PreFormOneTick } from "./pre-form-one-tick"

// The Pre-Form One tick on its own, for staff who can't view payments and so
// don't see the School fee panel (#114). Nothing about the fee or payments
// shows. It appears to staff who may tick it (`canEdit`, an open lead) when
// the lead is in FORM 1, and to everyone once it is ticked.
export async function PreFormOneTickSection({ leadId, formOne, canEdit }: { leadId: string; formOne: boolean; canEdit: boolean }) {
  const supabase = await createClient()
  const ticked = await getPreFormOneTick(supabase, leadId)
  if (ticked.ok && !ticked.data && !(canEdit && formOne)) return null

  return (
    <section aria-labelledby="lead-pre-form-one" className="lr-card">
      <h2 id="lead-pre-form-one" className="kit-card-title">
        Pre-Form One programme
      </h2>
      {!ticked.ok ? (
        // Unread, the tick could show unticked over a saved one, so nothing
        // about it shows until it loads.
        <Note tone="bad">The Pre-Form One programme could not be loaded. Try again in a moment.</Note>
      ) : (
        <div className="lr-box">
          <PreFormOneTick leadId={leadId} ticked={ticked.data} canTick={canEdit && formOne} canClear={canEdit} />
          {ticked.data && !formOne && (
            <p role="note" className="lr-warn">
              {PRE_FORM_ONE_NOT_APPLYING}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
