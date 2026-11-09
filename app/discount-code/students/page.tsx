import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import { signOutAndReturn } from "@/app/actions/session"
import { FieldInput } from "@/components/guided-form"
import { buttonVariants } from "@/components/ui/button"
import { referralLink, requestOrigin } from "@/lib/agent-registration"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import { getLanguage, type Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { getAgentUser } from "@/lib/services/agent-auth"
import { getAgentStudents, type AgentStudent } from "@/lib/services/agent-students"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY } from "../account-copy"
import { AccountMessageView, SignOutNotice } from "../account-message"
import { AccountShell } from "../account-shell"
import { COPY as DISCOUNT_COPY } from "../copy"
import { cardLines, MAX_SHOWN, PAGE_SIZE, shownFrom, STUDENTS_COPY } from "./copy"
import { ShareCode } from "./share-code"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return { title: `${copy.title} · Al-Rahmah Complex`, robots: { index: false, follow: false } }
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

// Where a signed-in Discount code holder lands: the students using their
// code (#195), newest first. A switched-off or retired agent, or anyone while
// agent access is off, sees only the message, read fresh on every visit.
export default async function AgentStudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const language = await getLanguage()
  const account = ACCOUNT_COPY[language]
  const supabase = await createClient()
  const agent = await getAgentUser(supabase)

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) redirect("/login")
  if (!agent.ok) {
    return (
      <AccountShell language={language} wide>
        <SignOutNotice language={language} message={account.messages[agent.error]} back="/login" />
      </AccountShell>
    )
  }

  const params = await searchParams
  const search = typeof params.q === "string" ? params.q.slice(0, 100) : ""
  const shown = shownFrom(params.n)
  const list = await getAgentStudents(supabase, { search, limit: shown, offset: 0 })

  if (!list.ok && list.error === "not-agent") redirect("/login")
  if (!list.ok || list.data.kind !== "active") {
    const message = account.messages[list.ok && list.data.kind !== "active" ? list.data.kind : "unavailable"]
    return (
      <AccountShell language={language} wide>
        <SignOutNotice language={language} message={message} back="/login" />
      </AccountShell>
    )
  }

  const { code, total, matched, students } = list.data
  const copy = STUDENTS_COPY[language]

  return (
    <AccountShell language={language} wide>
      <div className="flex flex-col gap-5">
        <h2 className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic [overflow-wrap:anywhere]">
          {copy.heading(code, total)}
        </h2>

        {total === 0 ? (
          <EmptyList language={language} code={code} />
        ) : (
          <>
            {(total > PAGE_SIZE || search) && <SearchForm language={language} search={search} />}
            {matched === 0 ? (
              <p className="text-[15px] text-slate-600">{copy.noMatch}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {students.map((student, index) => (
                  <StudentCard key={index} student={student} language={language} />
                ))}
              </ul>
            )}
            {matched > students.length && shown < MAX_SHOWN && (
              <Link
                href={`?${new URLSearchParams({ ...(search ? { q: search } : {}), n: String(shown + PAGE_SIZE) })}`}
                scroll={false}
                className="inline-flex min-h-12 items-center justify-center self-center rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-base font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.97]"
              >
                {copy.more}
              </Link>
            )}
            {matched > students.length && shown >= MAX_SHOWN && (
              <p className="text-sm text-slate-600">{copy.searchForMore}</p>
            )}
          </>
        )}

        <p className="text-sm text-slate-600">
          {copy.helpLine}{" "}
          <a
            href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`}
            className="whitespace-nowrap font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4"
          >
            {OFFICE_PHONE}
          </a>
        </p>

        <form action={signOutAndReturn} className="-ml-2.5 self-start">
          <input type="hidden" name="back" value="/login" />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-full px-2.5 font-exo text-[15px] font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            {account.signOut}
          </button>
        </form>
      </div>
    </AccountShell>
  )
}

function StudentCard({ student, language }: { student: AgentStudent; language: Language }) {
  const [status, ...rest] = cardLines(student, language)
  return (
    <li className="rounded-[20px] bg-[#f2f0fc] px-[18px] py-3.5">
      <p className="text-base leading-[1.35] font-semibold [overflow-wrap:anywhere] text-slate-800">
        {student.name} <span className="font-normal text-slate-600">· {student.className}</span>
      </p>
      <p className="mt-1 font-exo text-[15px] font-bold text-blue-600 italic">{status}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm text-slate-600">
          {line}
        </p>
      ))}
    </li>
  )
}

function SearchForm({ language, search }: { language: Language; search: string }) {
  const copy = STUDENTS_COPY[language]
  return (
    <form method="get" role="search" className="flex flex-col gap-2">
      <label htmlFor="student-search" className="text-[15px] font-semibold text-slate-800">
        {copy.searchLabel}
      </label>
      <div className="flex gap-2 max-[330px]:flex-col">
        <div className="min-w-0 flex-1">
          <FieldInput id="student-search" name="q" type="search" defaultValue={search} maxLength={100} alignStart />
        </div>
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "orange" }), "min-h-13 shrink-0 rounded-full px-6 font-exo text-lg italic shadow-md shadow-orange-500/20")}
        >
          {copy.search}
        </button>
      </div>
      {search && (
        <Link
          href="?"
          className="inline-flex min-h-11 items-center self-start rounded-full px-2.5 -ml-2.5 text-[15px] font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4"
        >
          {copy.showAll}
        </Link>
      )}
    </form>
  )
}

async function EmptyList({ language, code }: { language: Language; code: string }) {
  const copy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]
  const origin = requestOrigin(await headers())
  if (!origin) return <AccountMessageView language={language} message={ACCOUNT_COPY[language].messages.unavailable} />
  const link = referralLink(origin, code)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-slate-700">{copy.emptyText}</p>
      <ShareCode
        code={code}
        link={link}
        shareHref={discountCodeShareLink(share.shareText(code, link))}
        labels={{ linkLabel: share.linkLabel, copy: share.copy, copied: share.copied, copyFailed: share.copyFailed, share: share.share }}
      />
    </div>
  )
}
