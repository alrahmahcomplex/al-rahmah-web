import type { DayOrBoarding } from "@/lib/services/leads"
import type { PreFormOne } from "@/lib/services/lead-fees"

import { formatShillings } from "../../fees/format"
import { PRE_FORM_ONE_NOT_APPLYING } from "./pre-form-one-outcome"
import { PreFormOneTick } from "./pre-form-one-tick"

// The Pre-Form One programme on the School fee panel (#114), apart from the
// School fee: the tick, and once ticked, the programme fee for the lead's Day
// or boarding with no discount, what has been paid toward it and the
// balance. It shows on a FORM 1 lead, and on any lead that is ticked or has
// paid toward it. A tick on a lead moved off FORM 1 shows as not applying.
// `canEdit` is leads.edit on an open lead.
export function PreFormOneProgramme({
  leadId,
  programme,
  dayOrBoarding,
  canEdit,
}: {
  leadId: string
  programme: PreFormOne
  dayOrBoarding: DayOrBoarding | null
  canEdit: boolean
}) {
  const shown = programme.offered || programme.ticked || programme.paid > 0
  if (!shown) return null
  if (!programme.ticked && programme.paid === 0 && !canEdit) return null

  return (
    <section aria-labelledby="lead-pre-form-one" className="lr-box">
      <h3 id="lead-pre-form-one" className="sr-only">
        Pre-Form One programme
      </h3>
      <PreFormOneTick
        leadId={leadId}
        ticked={programme.ticked}
        canTick={canEdit && programme.offered}
        canClear={canEdit}
      />
      {programme.ticked && !programme.applies && (
        <p role="note" className="lr-warn">
          {PRE_FORM_ONE_NOT_APPLYING}
        </p>
      )}
      {(programme.ticked || programme.paid > 0) && (
        <dl className="kit-kv">
          <dt>
            Pre-Form One fee
            <small>{dayOrBoarding ? `${dayOrBoarding}, no discount` : "No discount"}</small>
          </dt>
          <dd className="kit-num">
            {programme.fee === null ? <span className="lr-quiet">No fee schedule</span> : `TZS ${formatShillings(programme.fee)}`}
          </dd>
          <dt>Pre-Form One paid</dt>
          <dd className="kit-num">TZS {formatShillings(programme.paid)}</dd>
          {programme.balance !== null && (
            <>
              <dt>Pre-Form One balance</dt>
              <dd className="kit-num">TZS {formatShillings(programme.balance)}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
