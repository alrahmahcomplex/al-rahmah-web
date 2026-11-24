import type { Metadata, Viewport } from "next"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { WELCOME_COOKIE } from "@/app/discount-code/students/welcome"
import { parseSidebarCookies, SIDEBAR_RAIL_COOKIE, SIDEBAR_WIDTH_COOKIE } from "@/app/staff/shell-cookies"
import { referralLink, requestOrigin } from "@/lib/agent-registration"
import { getLanguage } from "@/lib/language"
import { formatTanzanianMobile } from "@/lib/mask-login"
import { AGENTS_THEME_COLOR, PORTAL_APP_METADATA } from "@/lib/portal-app"
import { getAgentUser } from "@/lib/services/agent-auth"
import { pendingAgentCode } from "@/lib/services/agent-self-confirm"
import { currentAuthUser, verifiedUserId } from "@/lib/services/auth-session"
import { getAgentStudents, type AgentRecentChange } from "@/lib/services/agent-students"
import { createClient } from "@/utils/supabase/server"

import { AgentsShell, type AgentsShellProfile } from "./agents-shell"

export const metadata: Metadata = {
  ...PORTAL_APP_METADATA,
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: AGENTS_THEME_COLOR,
}

export default async function AgentsAppLayout({ children }: { children: ReactNode }) {
  const [language, cookieStore, requestHeaders, supabase] = await Promise.all([getLanguage(), cookies(), headers(), createClient()])
  const agent = await getAgentUser(supabase)

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) {
    redirect("/auth?from=home")
  }

  const origin = requestOrigin(requestHeaders)
  const { folded, width: sidebarWidth } = parseSidebarCookies(
    cookieStore.get(SIDEBAR_RAIL_COOKIE)?.value,
    cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value,
  )

  let limited = true
  let profile: AgentsShellProfile | null = null
  let recent: AgentRecentChange[] = []

  if (agent.ok) {
    const welcomed = (cookieStore.get(WELCOME_COOKIE)?.value ?? "").split(".")[0]
    const isWelcome = Boolean(welcomed && welcomed === (await verifiedUserId(supabase)))
    if (isWelcome) {
      profile = {
        fullName: agent.data.fullName,
        code: agent.data.code,
        phone: null,
        referralUrl: origin ? referralLink(origin, agent.data.code) : null,
      }
    } else {
      const summary = await getAgentStudents(supabase, { search: "", limit: 1, offset: 0 })
      if (!summary.ok && summary.error === "not-agent") redirect("/auth?from=home")
      if (summary.ok && summary.data.kind === "active") {
        limited = false
        recent = summary.data.recent
        profile = {
          fullName: agent.data.fullName,
          code: summary.data.code,
          phone: formatTanzanianMobile(summary.data.phone),
          referralUrl: origin ? referralLink(origin, summary.data.code) : null,
        }
      }
    }
  } else if (agent.error === "pending") {
    const [pendingCode, userResult] = await Promise.all([pendingAgentCode(supabase), currentAuthUser(supabase)])
    if (pendingCode.ok && pendingCode.data) {
      const user = userResult.ok ? userResult.data : null
      profile = {
        fullName: user?.fullName || pendingCode.data,
        code: pendingCode.data,
        phone: formatTanzanianMobile(user?.phone),
        referralUrl: origin ? referralLink(origin, pendingCode.data) : null,
      }
    }
  }

  return (
    <AgentsShell language={language} limited={limited} profile={profile} recent={recent} folded={folded} sidebarWidth={sidebarWidth}>
      {children}
    </AgentsShell>
  )
}
