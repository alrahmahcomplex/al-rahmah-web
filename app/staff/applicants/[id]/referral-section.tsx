import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { getLeadInterviews, type LeadInterview } from "@/lib/services/interviews"
import { getLeadReferral, type LeadReferral, type ReferralState } from "@/lib/services/referral"
import { cn } from "@/lib/utils"
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
    <section aria-labelledby="lead-referral" className="flex flex-col gap-3">
      <h2 id="lead-referral" className="text-sm font-semibold text-slate-900">
        Referral code
      </h2>
      {!referral.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The referral code could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex max-w-xl flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
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
  if (!referral.code || !referral.state) return <p className="text-sm text-muted-foreground">No referral code.</p>
  const promo = referral.kind === "promo"
  const label = promo ? promoStateLabel(referral.discountState ?? "unrecognised") : STATE_LABEL[referral.state]
  const good = promo ? referral.discountState === "active" : referral.state === "approved"
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-lg font-semibold text-slate-900" aria-label="Code">
          {referral.code}
        </p>
        <Badge
          variant={good ? "secondary" : referral.state === "unrecognised" && !promo ? "destructive" : "outline"}
          className={cn(good && "bg-emerald-50 text-emerald-800")}
        >
          {label}
        </Badge>
      </div>
      {promo ? (
        <>
          <p className="text-sm text-slate-900">
            <span className="text-muted-foreground">Promo code: </span>
            {referral.holderName}
            {referral.amountOff > 0 && <span className="text-muted-foreground"> · {formatTzs(referral.amountOff)} off</span>}
          </p>
          <p className="text-sm text-muted-foreground">{PROMO_NO_AGENT}</p>
        </>
      ) : (
        <p className="text-sm text-slate-900">
          {referral.agentName ? (
            <>
              <span className="text-muted-foreground">Marketing Agent: </span>
              {referral.agentName}
            </>
          ) : (
            <span className="text-muted-foreground">
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
    <div className="flex flex-col gap-0.5 border-t pt-3">
      <p className="text-xs text-muted-foreground">{line.label}</p>
      <p className="text-sm text-slate-900">
        <span className="font-semibold" aria-label={line.label}>
          {line.amount}
        </span>
        {line.note && <span className="text-muted-foreground"> · {line.note}</span>}
      </p>
      {line.pending && <p className="text-xs text-muted-foreground">The discount applies once the Manager approves the agent.</p>}
    </div>
  )
}
