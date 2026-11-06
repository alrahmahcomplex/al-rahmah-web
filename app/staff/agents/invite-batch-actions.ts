"use server"

import { revalidatePath } from "next/cache"

import { readInviteBudgetConfig, sendInviteBatch } from "@/lib/services/agent-invite-batches"
import { requirePermission } from "@/lib/services/staff-auth"
import { agentInviteSender } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"

import { ACCESS_OFF_CODE } from "./access-banner"
import { agentSetPasswordUrl } from "./invite-link"
import type { BatchActionOutcome } from "./invite-batch-outcome"

// Send invites on "Approved, no account yet" (#192): one batch, within one
// import when the screen shows one. The page reads the batch's report from
// the database afterwards, so the answer here is only the batch's id.
export async function sendMarketingAgentInviteBatch(importBatchId: string | null): Promise<BatchActionOutcome> {
  if (importBatchId !== null && typeof importBatchId !== "string") return { status: "refused", message: "That import can't be found." }
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (!allowed.ok) {
    if (allowed.error === "signed-out") return { status: "refused", message: "Your session has ended. Sign in again, then try again." }
    if (allowed.error === "unavailable") return { status: "refused", message: "No invites were sent. Try again in a moment." }
    return { status: "refused", message: "You don't have permission to send invites." }
  }
  const config = readInviteBudgetConfig()
  if (!config) {
    return {
      status: "refused",
      message: "No invites were sent: the daily email budget isn't configured (EMAIL_DAILY_CAP and STAFF_INVITE_RESERVE).",
    }
  }

  const result = await sendInviteBatch(supabase, agentInviteSender(), await agentSetPasswordUrl(), { config, importBatchId })
  revalidatePath("/staff/agents")
  if (result.ok) return { status: "finished", batchId: result.data.batchId }
  switch (result.error.kind) {
    case "forbidden":
      return { status: "refused", message: "You don't have permission to send invites." }
    case "access-off":
      return { status: "refused", message: `No invites were sent: agent access is off (${ACCESS_OFF_CODE}). Turn it on first.` }
    default:
      if (result.error.batchId) {
        return {
          status: "stopped",
          batchId: result.error.batchId,
          message: "The batch stopped early because something went wrong. Its report shows how far it got.",
        }
      }
      return { status: "refused", message: "No invites were sent. Try again in a moment." }
  }
}
