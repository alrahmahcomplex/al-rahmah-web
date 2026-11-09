import { Alert, AlertDescription } from "@/components/ui/alert"
import { getLeadFamily } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { FamilyPanel } from "./family-panel"

// The lead's Family on the lead screen: its brothers and sisters, those the
// Admission form matched and staff have not yet confirmed, and, for staff who
// may edit leads, confirming or rejecting that match and separating the lead
// from a Family it was wrongly joined to.
export async function FamilySection({
  leadId,
  studentName,
  canEdit,
}: {
  leadId: string
  studentName: string
  // Whether the staff member may edit this lead: leads.edit, on an open lead.
  canEdit: boolean
}) {
  const family = await getLeadFamily(await createClient(), leadId)

  return (
    <section aria-labelledby="lead-family" className="flex flex-col gap-3">
      <h2 id="lead-family" className="text-sm font-semibold text-slate-900">
        Family
      </h2>
      {family.ok ? (
        <FamilyPanel key={leadId} leadId={leadId} studentName={studentName} family={family.data} canEdit={canEdit} />
      ) : (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The Family could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
