import { ChevronRight, Phone } from "lucide-react"
import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import { signOutAndReturn } from "@/app/actions/session"
import { FieldInput, NoticeBox } from "@/components/guided-form"
import { FinishMark } from "@/components/kit/states"
import { buttonVariants } from "@/components/ui/button"
import { referralLink, requestOrigin } from "@/lib/agent-registration"
import { getLanguage, type Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { getAgentUser } from "@/lib/services/agent-auth"
import { getAgentStudents, type AgentStudent, type AgentStudentStatus } from "@/lib/services/agent-students"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY, type OffReason } from "../account-copy"
import { SignOutNotice } from "../account-message"
import { AccountOffCard } from "../account-off"
import { AccountShell } from "../account-shell"
import { COPY as DISCOUNT_COPY, discountWords } from "../copy"
import { cardLines, firstName, MAX_SHOWN, PAGE_SIZE, shownFrom, stepFrom, STUDENTS_COPY } from "./copy"
import { continueToStudents } from "./actions"
import { MessagePicker, Reminders, ShareCodeButton, type PickerWords } from "./dashboard"
import { WELCOME_COOKIE } from "./welcome"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return { title: `${copy.title} · Al-Rahmah Complex`, robots: { index: false, follow: false } }
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

// The agent dashboard (#497, prototype v47, the owner's pick B): where a
// signed-in Discount code holder lands. A greeting and their code, how many
// of their students stand at each step, who could use a reminder (sent from
// the agent's own WhatsApp, with no family number), then the students using
// their code (#195), newest first, filtered by step or searched by name.
// With no students yet, the ready-made share messages take the list's place.
//
// Right after the password is set it greets the agent once, with a button on
// to the list (state 4): set-password leaves a short-lived cookie naming the
// agent's code (./welcome.ts), and the button clears it. A switched-off or retired agent, or
// anyone while agent access is off, sees only that reason's card (state 6),
// read fresh on every visit. Without a session the agent signs in, under a
// note saying why (state 5).
const SIGN_IN = "/auth?from=students"
const OFF = new Set<string>(["switched-off", "retired", "access-off"] satisfies OffReason[])
const isOff = (reason: string): reason is OffReason => OFF.has(reason)
const STEPS = ["Applied", "Visited", "Interviewed", "Enrolled"] as const satisfies AgentStudentStatus[]

const SECTION_HEADING = "font-exo text-[17px] leading-tight font-extrabold text-blue-600 italic"

export default async function AgentStudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const language = await getLanguage()
  const account = ACCOUNT_COPY[language]
  const supabase = await createClient()
  const agent = await getAgentUser(supabase)

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) redirect(SIGN_IN)
  if (!agent.ok) {
    return (
      <AccountShell language={language} wide>
        {isOff(agent.error) ? (
          <AccountOffCard language={language} reason={agent.error} />
        ) : (
          <SignOutNotice language={language} message={account.messages[agent.error]} back="/auth" />
        )}
      </AccountShell>
    )
  }

  const copy = STUDENTS_COPY[language]
  const params = await searchParams
  if ((await cookies()).get(WELCOME_COOKIE)?.value === agent.data.code) return <Welcome language={language} />

  const search = typeof params.q === "string" ? params.q.slice(0, 100) : ""
  const step = stepFrom(params.step)
  const shown = shownFrom(params.n)
  const list = await getAgentStudents(supabase, { search, limit: shown, offset: 0, step })

  if (!list.ok && list.error === "not-agent") redirect(SIGN_IN)
  if (!list.ok || list.data.kind !== "active") {
    return (
      <AccountShell language={language} wide>
        {list.ok && list.data.kind !== "active" ? (
          <AccountOffCard language={language} reason={list.data.kind} />
        ) : (
          <SignOutNotice language={language} message={account.messages.unavailable} back="/auth" />
        )}
      </AccountShell>
    )
  }

  const { code, total, matched, students, steps, reminders, discount } = list.data
  const share = DISCOUNT_COPY[language]
  const origin = requestOrigin(await headers())
  const link = origin ? referralLink(origin, code) : null
  const amount = discountWords(discount)
  const picker = link
    ? {
        link,
        messages: {
          parent: share.shareText(code, link, amount),
          group: share.shareGroupText(code, link, amount),
          short: share.shareShortText(code, link, amount),
        },
        words: {
          pickMessage: copy.pickMessage,
          labels: copy.messages,
          share: share.share,
          copyMessage: copy.copyMessage,
          messageCopied: copy.messageCopied,
          copyLink: share.copy,
          linkCopied: share.copied,
          copyFailed: share.copyFailed,
        } satisfies PickerWords,
      }
    : null
  const query = (change: Record<string, string | null>) => {
    const next = new URLSearchParams()
    const values = { q: search || null, step, ...change }
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value)
    const text = next.toString()
    return text ? `?${text}` : "?"
  }

  return (
    <AccountShell language={language} wide>
      <div className="flex flex-col gap-5">
        <h2 className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic [overflow-wrap:anywhere]">
          {copy.hello(firstName(agent.data.fullName))}
        </h2>
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-sm text-slate-700">
            {copy.yourCode} <b className="font-mono text-[15px] tracking-wide text-blue-600">{code}</b>
          </p>
          {total > 0 && picker && <ShareCodeButton label={copy.shareCode} closeLabel={copy.close} {...picker} />}
        </div>

        {total === 0 ? (
          <>
            <NoticeBox tone="info" className="text-[15px]">
              {copy.emptyNote}
            </NoticeBox>
            {picker && <MessagePicker {...picker} />}
          </>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className={SECTION_HEADING}>{copy.whereFamilies}</h2>
              <div className="grid grid-cols-4 gap-1.5">
                {STEPS.map((status) => (
                  <p key={status} className="m-0 flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border-[1.5px] border-slate-200 bg-white px-1 pt-2.5 pb-2">
                    <b className={cn("font-exo text-[22px] leading-none font-extrabold italic", status === "Enrolled" ? "text-[#0f7a3d]" : "text-blue-600")}>
                      {steps[status]}
                    </b>
                    <small className="text-center text-[11px] leading-tight wrap-anywhere text-slate-600">{copy.statuses[status]}</small>
                  </p>
                ))}
              </div>
              {steps.Declined > 0 && (
                <p className="text-[13px] text-slate-500">
                  {copy.statuses.Declined}: {steps.Declined}
                </p>
              )}
            </section>

            {reminders.length > 0 && (
              <Reminders
                items={reminders.map((reminder) => ({
                  name: reminder.name,
                  className: reminder.className,
                  waiting: copy.waiting[reminder.step](reminder.days),
                  message: copy.reminder[reminder.step](firstName(reminder.name), OFFICE_PHONE),
                }))}
                words={{
                  heading: copy.remindHeading(reminders.length),
                  prepare: copy.prepare,
                  title: copy.reminderTitle,
                  openWhatsApp: copy.openWhatsApp,
                  copyMessage: copy.copyMessage,
                  messageCopied: copy.messageCopied,
                  close: copy.close,
                }}
              />
            )}

            <nav className="flex flex-wrap gap-1.5" aria-label={copy.whereFamilies}>
              {([null, ...STEPS, "Declined"] as const).map((status) => (
                <Link
                  key={status ?? "all"}
                  href={query({ step: status, n: null })}
                  scroll={false}
                  aria-current={step === status ? "page" : undefined}
                  className="inline-flex min-h-9 items-center rounded-full border-[1.5px] border-blue-600/30 bg-white px-3 text-[13px] font-semibold text-blue-600 aria-[current=page]:border-blue-600 aria-[current=page]:bg-blue-600 aria-[current=page]:text-white"
                >
                  {status ? copy.statuses[status] : copy.all} ({status ? steps[status] : total})
                </Link>
              ))}
            </nav>

            {(total > PAGE_SIZE || search) && <SearchForm language={language} search={search} step={step} />}
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
                href={query({ n: String(shown + PAGE_SIZE) })}
                scroll={false}
                className="inline-flex min-h-12 items-center justify-center self-center rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-base font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring) active:scale-[0.97]"
              >
                {copy.more}
              </Link>
            )}
            {matched > students.length && shown >= MAX_SHOWN && <p className="text-sm text-slate-600">{copy.searchForMore}</p>}
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
          <input type="hidden" name="back" value="/auth" />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-full px-2.5 font-exo text-[15px] font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
          >
            {account.signOut}
          </button>
        </form>
      </div>
    </AccountShell>
  )
}

// State 4, once, right after the password is set: approved, signed in, and
// the one orange button on to the list at this same address.
function Welcome({ language }: { language: Language }) {
  const copy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]
  return (
    <AccountShell language={language} wide>
      <section className="flex flex-col items-center gap-4 text-center">
        <FinishMark />
        <h2 className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic">{copy.approved}</h2>
        <p className="text-[15px] text-slate-700">{copy.signedInNote}</p>
        <form action={continueToStudents} className="w-full">
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "orange" }), "h-auto min-h-13 w-full justify-between gap-3 rounded-full py-2.5 pr-4 pl-6 text-left font-exo text-lg whitespace-normal italic shadow-md shadow-orange-500/20")}
        >
          {share.seeStudents}
          <ChevronRight className="size-5" aria-hidden />
        </button>
        </form>
        <div className="flex flex-col items-center">
          <p className="text-sm text-slate-600">{share.call}</p>
          <a
            href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`}
            className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
          >
            <Phone className="size-5" strokeWidth={2} aria-hidden />
            {OFFICE_PHONE}
          </a>
        </div>
      </section>
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

// The name search; it keeps the step being shown. Its button is outlined: the
// page's one orange button is the first reminder's.
function SearchForm({ language, search, step }: { language: Language; search: string; step: AgentStudentStatus | null }) {
  const copy = STUDENTS_COPY[language]
  return (
    <form method="get" role="search" className="flex flex-col gap-2">
      <label htmlFor="student-search" className="text-[15px] font-semibold text-slate-800">
        {copy.searchLabel}
      </label>
      {step && <input type="hidden" name="step" value={step} />}
      <div className="flex gap-2 max-[330px]:flex-col">
        <div className="min-w-0 flex-1">
          <FieldInput id="student-search" name="q" type="search" defaultValue={search} maxLength={100} alignStart />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-13 shrink-0 items-center justify-center rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
        >
          {copy.search}
        </button>
      </div>
      {search && (
        <Link
          href={step ? `?step=${step}` : "?"}
          className="-ml-2.5 inline-flex min-h-11 items-center self-start rounded-full px-2.5 text-[15px] font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4"
        >
          {copy.showAll}
        </Link>
      )}
    </form>
  )
}
