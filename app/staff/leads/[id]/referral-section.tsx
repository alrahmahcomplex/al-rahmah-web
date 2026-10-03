import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { getLeadReferral, type LeadReferral, type ReferralState } from "@/lib/services/referral"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { ReferralEditor } from "./referral-editor"
import { formatTzs } from "./referral-outcome"

const STATE_LABEL: Record<ReferralState, string> = {
  approved: "Approved",
  pending: "Pending",
  unrecognised: "Unrecognised",
}

// The lead's Referral code panel: the code, its state and the agent it names,
// and the expected interview fee. Staff who hold leads.edit get Edit and
// Clear on an open lead; everyone else, and a closed lead, read it only.
export async function ReferralSection({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const referral = await getLeadReferral(await createClient(), leadId)

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
          <Fee referral={referral.data} />
          {canEdit && (
            <ReferralEditor
              key={leadId}
              leadId={leadId}
              current={referral.data.code ? { code: referral.data.code, agentName: referral.data.agentName } : null}
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
  const state = referral.state
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-lg font-semibold text-slate-900" aria-label="Code">
          {referral.code}
        </p>
        <Badge
          variant={state === "approved" ? "secondary" : state === "unrecognised" ? "destructive" : "outline"}
          className={cn(state === "approved" && "bg-emerald-50 text-emerald-800")}
        >
          {STATE_LABEL[state]}
        </Badge>
      </div>
      <p className="text-sm text-slate-900">
        {referral.agentName ? (
          <>
            <span className="text-muted-foreground">Marketing Agent: </span>
            {referral.agentName}
          </>
        ) : (
          <span className="text-muted-foreground">No Marketing Agent has this code. Correct it if the family can check it.</span>
        )}
      </p>
    </div>
  )
}

function Fee({ referral }: { referral: LeadReferral }) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-3">
      <p className="text-xs text-muted-foreground">Expected interview fee</p>
      <p className="text-sm text-slate-900">
        <span className="font-semibold" aria-label="Expected interview fee">
          {formatTzs(referral.amount)}
        </span>
        {referral.discountApplied && <span className="text-muted-foreground"> · includes {formatTzs(20000)} discount</span>}
      </p>
      {referral.state === "pending" && (
        <p className="text-xs text-muted-foreground">The discount applies once the Manager approves the agent.</p>
      )}
    </div>
  )
}
