import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { AgentAccess, AgentAccessError } from "@/lib/services/agent-access"
import type { Result } from "@/lib/services/result"

// The reason code an agent sees while agent access is off, so staff on the
// phone can tell it apart from a switched-off agent.
export const ACCESS_OFF_CODE = "access_off"

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// "Off since setup", or the state with when it changed and who changed it.
export function agentAccessLine(access: AgentAccess): string {
  const state = access.enabled ? "On" : "Off"
  if (!access.changedAt || !access.changedBy) return `${state} since setup`
  const who = access.changedBy.kind === "staff" ? access.changedBy.name : "the system"
  return `${state} since ${WHEN.format(new Date(access.changedAt))}, changed by ${who}`
}

export function AgentAccessBanner({ access }: { access: Result<AgentAccess, AgentAccessError> }) {
  if (!access.ok) {
    return (
      <Alert>
        <AlertTitle>Agent access</AlertTitle>
        <AlertDescription>Whether agent access is on could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  const { enabled } = access.data
  return (
    <Alert className={enabled ? undefined : "border-amber-300 bg-amber-50"}>
      <AlertTitle>Agent access: {agentAccessLine(access.data)}</AlertTitle>
      <AlertDescription>
        {enabled
          ? "Agents may sign up, claim a code, sign in and reset a password."
          : `No agent can sign up, claim a code, sign in or reset a password. They see the reason code ${ACCESS_OFF_CODE}.`}
      </AlertDescription>
    </Alert>
  )
}
