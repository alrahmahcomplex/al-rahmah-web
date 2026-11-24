import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import type { OffReason } from "@/app/discount-code/account-copy"
import { WELCOME_COOKIE } from "@/app/discount-code/students/welcome"
import { Icon } from "@/components/icons"
import { Card, CodeChip, ListRow, Note, PageHeader, TaskCard, pageTitle } from "@/components/kit"
import { referralLink, requestOrigin } from "@/lib/agent-registration"
import { getLanguage, type Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { getAgentUser } from "@/lib/services/agent-auth"
import { pendingAgentCode } from "@/lib/services/agent-self-confirm"
import { verifiedUserId } from "@/lib/services/auth-session"
import { getAgentStudents } from "@/lib/services/agent-students"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY, AGENTS_COPY, DISCOUNT_COPY, discountWords, firstName, STUDENTS_COPY, whatsAppHref } from "../copy"
import { HomeMessagePicker, OfficeCallLine, WaitingCodeView, WelcomeFinishView } from "./share-actions"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: pageTitle(AGENTS_COPY[language].navHome) }
}

const OFF_REASONS = new Set<string>(["switched-off", "retired", "access-off"] satisfies OffReason[])
const isOff = (value: string): value is OffReason => OFF_REASONS.has(value)

function OffCard({ language, reason }: { language: Language; reason: OffReason }) {
  const { title, text } = ACCOUNT_COPY[language].off[reason]
  return (
    <div className="ag-narrow">
      <TaskCard>
        <section role="alert" className="ag-done">
          <span className="ag-disc" aria-hidden="true">
            <Icon name={reason === "retired" ? "info" : "clock"} size={24} featured />
          </span>
          <h1 className="ag-done-title">{title}</h1>
          <Note tone={reason === "retired" ? "info" : "wait"}>{text}</Note>
          <OfficeCallLine language={language} officePhone={OFFICE_PHONE} />
        </section>
      </TaskCard>
    </div>
  )
}

function UnavailableCard({ language }: { language: Language }) {
  return (
    <div className="ag-narrow">
      <TaskCard>
        <section role="alert" className="ag-done">
          <Note tone="bad">{ACCOUNT_COPY[language].messages.unavailable.text}</Note>
          <OfficeCallLine language={language} officePhone={OFFICE_PHONE} />
        </section>
      </TaskCard>
    </div>
  )
}

export default async function AgentsHomePage() {
  const [language, cookieStore, requestHeaders, supabase] = await Promise.all([getLanguage(), cookies(), headers(), createClient()])
  const agent = await getAgentUser(supabase)

  if (!agent.ok && (agent.error === "signed-out" || agent.error === "not-agent")) {
    redirect("/auth?from=home")
  }

  const origin = requestOrigin(requestHeaders)

  if (!agent.ok && agent.error === "pending") {
    const [pendingCode, userId] = await Promise.all([pendingAgentCode(supabase), verifiedUserId(supabase)])
    if (!pendingCode.ok || !pendingCode.data) return <UnavailableCard language={language} />
    const code = pendingCode.data
    const link = origin ? referralLink(origin, code) : null
    const shareText = link ? DISCOUNT_COPY[language].shareText(code, link, null) : null
    const welcomed = (cookieStore.get(WELCOME_COOKIE)?.value ?? "").split(".")[0]
    return (
      <div className="ag-narrow">
        <TaskCard>
          <WaitingCodeView
            language={language}
            code={code}
            link={link}
            shareText={shareText}
            officePhone={OFFICE_PHONE}
            justJoined={Boolean(welcomed && welcomed === userId)}
          />
        </TaskCard>
      </div>
    )
  }

  if (!agent.ok) {
    return isOff(agent.error) ? <OffCard language={language} reason={agent.error} /> : <UnavailableCard language={language} />
  }

  const welcomeValue = cookieStore.get(WELCOME_COOKIE)?.value
  const [welcomed, how] = (welcomeValue ?? "").split(".")
  if (welcomed && welcomed === (await verifiedUserId(supabase))) {
    return (
      <div className="ag-narrow">
        <TaskCard>
          <WelcomeFinishView language={language} selfConfirmed={how === "self"} officePhone={OFFICE_PHONE} />
        </TaskCard>
      </div>
    )
  }

  const list = await getAgentStudents(supabase, { search: "", limit: 1, offset: 0 })
  if (!list.ok && list.error === "not-agent") redirect("/auth?from=home")
  if (list.ok && list.data.kind === "pending") redirect("/home")
  if (!list.ok || list.data.kind !== "active") {
    return list.ok && isOff(list.data.kind) ? <OffCard language={language} reason={list.data.kind} /> : <UnavailableCard language={language} />
  }

  const { code, total, steps, reminders, discount } = list.data
  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]
  const link = origin ? referralLink(origin, code) : null
  const amount = discountWords(discount)
  const messages = link
    ? {
        parent: share.shareText(code, link, amount),
        group: share.shareGroupText(code, link, amount),
        short: share.shareShortText(code, link, amount),
      }
    : null

  const shareCard = link && messages && (
    <Card title={studentsCopy.shareCode} caption={studentsCopy.pickMessage}>
      <HomeMessagePicker language={language} link={link} messages={messages} />
    </Card>
  )

  const shownReminders = reminders.slice(0, 3)

  return (
    <>
      <PageHeader
        className="ag-ph"
        title={studentsCopy.hello(firstName(agent.data.fullName))}
        actions={
          <CodeChip
            code={code}
            prefix={studentsCopy.yourCode}
            copyValue={link}
            copyLabel={share.copy}
            copiedMessage={share.copied}
            copyFailedMessage={share.copyFailed}
          />
        }
      />

      {messages && (
        <a href={whatsAppHref(messages.parent)} target="_blank" rel="noopener noreferrer" className="kit-btn kit-go ag-wa">
          <Icon name="chat" />
          <span>{copy.shareWa}</span>
        </a>
      )}

      {total === 0 ? (
        <div className="ag-cols">
          <Note>{studentsCopy.emptyNote}</Note>
          {shareCard}
        </div>
      ) : (
        <>
          <Card title={studentsCopy.whereFamilies}>
            <div className="ag-stats">
              <Link href="/students" className="ag-stat">
                <small>{copy.allApplied}</small>
                <b>{total}</b>
              </Link>
              <Link href="/students?step=Interviewed" className="ag-stat">
                <small>{studentsCopy.statuses.Interviewed}</small>
                <b>{steps.Interviewed}</b>
              </Link>
              <Link href="/students?step=Enrolled" className="ag-stat" data-tone="enrolled">
                <small>{studentsCopy.statuses.Enrolled}</small>
                <b>{steps.Enrolled}</b>
              </Link>
              <Link href="/students?step=Declined" className="ag-stat" data-tone="declined">
                <small>{studentsCopy.statuses.Declined}</small>
                <b>{steps.Declined}</b>
              </Link>
            </div>
          </Card>

          <div className={reminders.length > 0 ? "ag-cols" : "ag-cols ag-cols-single"}>
            {reminders.length > 0 && (
              <Card title={studentsCopy.remindHeading(reminders.length)}>
                {shownReminders.map((item) => (
                  <ListRow
                    key={item.id}
                    inset
                    icon="followups"
                    title={
                      <>
                        {item.name} <span className="ag-row-cls">· {item.className}</span>
                      </>
                    }
                    caption={copy.remindLine[item.step]}
                    href={`/students/${item.id}`}
                  />
                ))}
                {reminders.length > 3 && (
                  <div className="ag-allrow">
                    <Link href="/reminders" className="kit-link">
                      {studentsCopy.seeAllReminders(reminders.length)}
                    </Link>
                  </div>
                )}
              </Card>
            )}
            {shareCard}
          </div>
        </>
      )}

      <p className="ag-help">
        {studentsCopy.helpLine}{" "}
        <a href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`} className="ag-tel">
          {OFFICE_PHONE}
        </a>
      </p>
    </>
  )
}
