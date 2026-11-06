import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import { signOutAndReturn } from "@/app/actions/session"
import { referralLink, requestOrigin } from "@/lib/agent-registration"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import { getLanguage, type Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { getAgentUser } from "@/lib/services/agent-auth"
import { getAgentStudents, type AgentStudent } from "@/lib/services/agent-students"
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

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) redirect("/discount-code/sign-in")
  if (!agent.ok) {
    return (
      <AccountShell language={language} wide>
        <SignOutNotice language={language} message={account.messages[agent.error]} back="/discount-code/sign-in" />
      </AccountShell>
    )
  }

  const params = await searchParams
  const search = typeof params.q === "string" ? params.q.slice(0, 100) : ""
  const shown = shownFrom(params.n)
  const list = await getAgentStudents(supabase, { search, limit: shown, offset: 0 })

  if (!list.ok && list.error === "not-agent") redirect("/discount-code/sign-in")
  if (!list.ok || list.data.kind !== "active") {
    const message = account.messages[list.ok && list.data.kind !== "active" ? list.data.kind : "unavailable"]
    return (
      <AccountShell language={language} wide>
        <SignOutNotice language={language} message={message} back="/discount-code/sign-in" />
      </AccountShell>
    )
  }

  const { code, total, matched, students } = list.data
  const copy = STUDENTS_COPY[language]

  return (
    <AccountShell language={language} wide>
      <div className="flex flex-col gap-5">
        <h1 className="font-exo text-2xl font-extrabold italic leading-tight text-blue-600">{copy.heading(code, total)}</h1>

        {total === 0 ? (
          <EmptyList language={language} code={code} />
        ) : (
          <>
            {(total > PAGE_SIZE || search) && <SearchForm language={language} search={search} />}
            {matched === 0 ? (
              <p className="font-exo text-[14px] text-slate-600">{copy.noMatch}</p>
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
                className="inline-flex h-11 items-center justify-center self-center rounded-full border border-blue-600/30 px-6 font-exo text-base font-bold italic text-blue-600 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
              >
                {copy.more}
              </Link>
            )}
            {matched > students.length && shown >= MAX_SHOWN && (
              <p className="font-exo text-[13px] text-slate-600">{copy.searchForMore}</p>
            )}
          </>
        )}

        <p className="font-exo text-[13px] text-slate-600">
          {copy.helpLine}{" "}
          <a href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`} className="whitespace-nowrap text-blue-600 underline underline-offset-2">
            {OFFICE_PHONE}
          </a>
        </p>

        <form action={signOutAndReturn} className="self-start">
          <input type="hidden" name="back" value="/discount-code/sign-in" />
          <button type="submit" className="font-exo text-[13px] text-blue-600 underline underline-offset-2">
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
    <li className="rounded-3xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
      <p className="font-exo text-base font-bold text-slate-900">
        {student.name} <span className="font-normal text-slate-600">· {student.className}</span>
      </p>
      <p className="mt-1 font-exo text-[14px] font-semibold text-blue-700">{status}</p>
      {rest.map((line) => (
        <p key={line} className="font-exo text-[13px] text-slate-600">
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
      <label htmlFor="student-search" className="font-exo text-[13px] font-semibold text-slate-700">
        {copy.searchLabel}
      </label>
      <div className="flex gap-2">
        <input
          id="student-search"
          name="q"
          type="search"
          defaultValue={search}
          maxLength={100}
          className="h-11 min-w-0 flex-1 rounded-full border border-slate-300 px-4 font-exo text-base outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-full bg-blue-600 px-5 font-exo text-base font-bold italic text-white hover:bg-blue-700"
        >
          {copy.search}
        </button>
      </div>
      {search && (
        <Link href="?" className="self-start font-exo text-[13px] text-blue-600 underline underline-offset-2">
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
      <p className="font-exo text-[14px] text-slate-700">{copy.emptyText}</p>
      <ShareCode
        code={code}
        link={link}
        shareHref={discountCodeShareLink(share.shareText(code, link))}
        labels={{ linkLabel: share.linkLabel, copy: share.copy, copied: share.copied, copyFailed: share.copyFailed, share: share.share }}
      />
    </div>
  )
}
