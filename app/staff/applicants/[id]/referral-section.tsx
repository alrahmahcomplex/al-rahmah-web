import { Note, Tag } from "@/components/kit"
import { getLeadInterviews, type LeadInterview } from "@/lib/services/interviews"
import { getLeadReferral, type LeadReferral, type ReferralState } from "@/lib/services/referral"
import { createClient } from "@/utils/supabase/server"

import { ReferralEditor } from "./referral-editor"
import { formatTzs, PROMO_NO_AGENT, promoStateLabel, referralFeeLine } from "./referral-outcome"

const STATE_LABEL: Record<ReferralState, string> = {
  approved: "Approved",
  pending: "Pending",
  switched_off: "Switched off",
  unrecognised: "Unrecognised",
}

// The lead's Referral code panel: the code, its state and the agent or
// Promo code it names, and the expected interview fee, or the amount paid
// once the current interview's fee is Paid. Staff who hold leads.edit get
// Edit and Clear on an open lead; everyone else, and a closed lead, read it
// only.
export async function ReferralSection({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const supabase = await createClient()
  const [referral, interviews] = await Promise.all([getLeadReferral(supabase, leadId), getLeadInterviews(supabase, leadId)])
  // The newest registration is the current interview.
  const current = interviews.ok ? (interviews.data[0] ?? null) : null

  return (
    <section aria-labelledby="lead-referral" className="lr-card">
      <h2 id="lead-referral" className="kit-card-title">
        Referral code
      </h2>
      {!referral.ok ? (
        <Note tone="bad">The referral code could not be loaded. Try again in a moment.</Note>
      ) : (
        <div className="flex flex-col gap-4">
          <Code referral={referral.data} />
          <Fee referral={referral.data} current={current} />
          {canEdit && (
            <ReferralEditor
              key={leadId}
              leadId={leadId}
              current={
                referral.data.code
                  ? { code: referral.data.code, holderName: referral.data.kind === "none" ? null : referral.data.holderName }
                  : null
              }
              discountApplied={referral.data.discountApplied}
            />
          )}
        </div>
      )}
    </section>
  )
}

function Code({ referral }: { referral: LeadReferral }) {
  if (!referral.code || !referral.state) return <p className="lr-quiet">No referral code.</p>
  const promo = referral.kind === "promo"
  const label = promo ? promoStateLabel(referral.discountState ?? "unrecognised") : STATE_LABEL[referral.state]
  const good = promo ? referral.discountState === "active" : referral.state === "approved"
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="lr-num lr-strong text-lg" aria-label="Code">
          {referral.code}
        </p>
        <Tag tone={good ? "ok" : referral.state === "unrecognised" && !promo ? "bad" : "line"}>{label}</Tag>
      </div>
      {promo ? (
        <>
          <p className="lr-text">
            <span className="lr-quiet">Promo code: </span>
            {referral.holderName}
            {referral.amountOff > 0 && <span className="lr-quiet"> · {formatTzs(referral.amountOff)} off</span>}
          </p>
          <p className="lr-quiet">{PROMO_NO_AGENT}</p>
        </>
      ) : (
        <p className="lr-text">
          {referral.agentName ? (
            <>
              <span className="lr-quiet">Marketing Agent: </span>
              {referral.agentName}
            </>
          ) : (
            <span className="lr-quiet">
              No Marketing Agent or Promo code has this code. Correct it if the family can check it.
            </span>
          )}
        </p>
      )}
    </div>
  )
}

function Fee({ referral, current }: { referral: LeadReferral; current: LeadInterview | null }) {
  const line = referralFeeLine(referral, current)
  return (
    <div className="lr-part gap-0.5">
      <p className="lr-hint">{line.label}</p>
      <p className="lr-text">
        <span className="font-semibold" aria-label={line.label}>
          {line.amount}
        </span>
        {line.note && <span className="lr-quiet"> · {line.note}</span>}
      </p>
      {line.pending && <p className="lr-hint">The discount applies once the Manager approves the agent.</p>}
    </div>
  )
}
