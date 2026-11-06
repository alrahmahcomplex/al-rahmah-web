import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { signOutAndReturn } from "@/app/actions/session"
import { getLanguage } from "@/lib/language"
import { getAgentUser } from "@/lib/services/agent-auth"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY } from "../account-copy"
import { SignOutNotice } from "../account-message"
import { AccountShell } from "../account-shell"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return { title: `${copy.title} · Al-Rahmah Complex`, robots: { index: false, follow: false } }
}

// Where a signed-in Discount code holder lands. #195 fills in their students;
// until then it greets them. A switched-off agent, or anyone while agent
// access is off, sees only the message, read fresh on every visit.
export default async function AgentStudentsPage() {
  const language = await getLanguage()
  const copy = ACCOUNT_COPY[language]
  const agent = await getAgentUser(await createClient())

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) redirect("/discount-code/sign-in")

  return (
    <AccountShell language={language} wide>
      {agent.ok ? (
        <div className="flex flex-col gap-4">
          <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{copy.studentsHeading(agent.data.code)}</h1>
          <p className="font-exo text-[14px] text-slate-700">{copy.welcome(agent.data.fullName)}</p>
          <p className="font-exo text-[13px] text-slate-500">{copy.studentsComing}</p>
          <form action={signOutAndReturn} className="self-start">
            <input type="hidden" name="back" value="/discount-code/sign-in" />
            <button type="submit" className="font-exo text-[13px] text-blue-600 underline underline-offset-2">
              {copy.signOut}
            </button>
          </form>
        </div>
      ) : (
        <SignOutNotice language={language} message={copy.messages[agent.error]} back="/discount-code/sign-in" />
      )}
    </AccountShell>
  )
}
