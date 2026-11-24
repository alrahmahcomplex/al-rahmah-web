"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import Form from "next/form"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { signOutLocalAndReturn } from "@/app/actions/session"
import { NewShell } from "@/app/staff/_new-shell/new-shell"
import { initials } from "@/app/staff/_new-shell/top-bar-parts"
import type { ShellItem } from "@/app/staff/shell-types"
import { Icon } from "@/components/icons"
import {
  Button,
  Field,
  KeyValueList,
  ListRow,
  MenuProfileRow,
  Popover,
  ProfileHeader,
  RoundButton,
  Sheet,
  TopBarHomeOrBack,
  toast,
} from "@/components/kit"
import { LanguageSwitch } from "@/components/language-switch"
import type { Language } from "@/lib/language"
import type { AgentRecentChange } from "@/lib/services/agent-students"

import "./agents.css"
import { ACCOUNT_COPY, AGENTS_COPY, DISCOUNT_COPY, STUDENTS_COPY } from "./copy"

const BELL_SEEN_KEY = "ar-agents-bell-seen-v1"
const bellListeners = new Set<() => void>()

function readSeenRaw(): string {
  try {
    return window.localStorage.getItem(BELL_SEEN_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function parseSeenKeys(raw: string | null): Set<string> | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === "string"))
  } catch {
    return new Set()
  }
}

function subscribeSeen(listener: () => void) {
  bellListeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === BELL_SEEN_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    bellListeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function writeSeenKeys(keys: readonly string[]) {
  try {
    window.localStorage.setItem(BELL_SEEN_KEY, JSON.stringify(keys.slice(0, 50)))
  } catch {
    // Device storage may be blocked in private mode; ignore silently.
  }
  bellListeners.forEach((listener) => listener())
}

const changeKey = (item: AgentRecentChange) => `${item.id}:${item.status}`

function AgentsSearchForm({ placeholder, query }: { placeholder: string; query: string }) {
  const [typed, setTyped] = useState(query)
  const [typedFor, setTypedFor] = useState(query)
  if (typedFor !== query) {
    setTypedFor(query)
    setTyped(query)
  }
  return (
    <Form action="/students" role="search" className="ns-search">
      <Field
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        size="search"
        icon="search"
        name="q"
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        maxLength={100}
      />
    </Form>
  )
}

function StudentsAwareSearch({ placeholder }: { placeholder: string }) {
  const onStudents = usePathname() === "/students"
  const params = useSearchParams()
  const query = onStudents ? (params.get("q") ?? "") : ""
  return <AgentsSearchForm placeholder={placeholder} query={query} />
}

function AgentsBell({ language, recent }: { language: Language; recent: readonly AgentRecentChange[] }) {
  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]
  const [open, setOpen] = useState(false)
  const seenRaw = useSyncExternalStore(subscribeSeen, readSeenRaw, () => null)
  const seen = parseSeenKeys(seenRaw)

  const unread = seen === null ? 0 : recent.filter((item) => !seen.has(changeKey(item))).length

  function markAllSeen() {
    const next = new Set(seen ?? [])
    for (const item of recent) next.add(changeKey(item))
    writeSeenKeys([...next])
  }

  function closeOnLink(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("a")) setOpen(false)
  }

  return (
    <span className="ns-bellw">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) markAllSeen()
        }}
        trigger={
          <RoundButton
            icon="bell"
            label={unread > 0 ? `${copy.newsTitle} (${unread})` : copy.newsTitle}
            size={40}
          />
        }
        title={copy.newsTitle}
        closeLabel={studentsCopy.close}
      >
        {recent.length === 0 ? (
          <p className="ns-pop-line">{copy.noNews}</p>
        ) : (
          <div className="ns-requests" onClick={closeOnLink}>
            {recent.map((item) => (
              <ListRow
                key={item.id}
                icon="applicants"
                title={item.name}
                caption={`${studentsCopy.statuses[item.status]} · ${copy.ago(item.days)}`}
                href={`/students/${item.id}`}
              />
            ))}
          </div>
        )}
      </Popover>
      {unread > 0 && (
        <i className="ns-pip" aria-hidden="true">
          {unread}
        </i>
      )}
    </span>
  )
}

function ConfirmSignOutButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="bad" size="wide" pending={pending} className="ag-bad-fill">
      {label}
    </Button>
  )
}

export type AgentsShellProfile = {
  fullName: string
  code: string
  phone: string | null
  referralUrl: string | null
}

function AgentsMenu({ language, profile }: { language: Language; profile: AgentsShellProfile | null }) {
  const copy = AGENTS_COPY[language]
  const account = ACCOUNT_COPY[language]
  const share = DISCOUNT_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [prevLanguage, setPrevLanguage] = useState(language)
  if (prevLanguage !== language) {
    setPrevLanguage(language)
    if (menuOpen) setMenuOpen(false)
  }

  async function copyReferralLink() {
    if (!profile?.referralUrl) return
    try {
      await navigator.clipboard.writeText(profile.referralUrl)
      toast(share.copied, { tone: "good" })
    } catch {
      toast(share.copyFailed, { tone: "bad" })
    }
  }

  return (
    <>
      <BasePopover.Root open={menuOpen} onOpenChange={setMenuOpen} modal="trap-focus">
        <BasePopover.Trigger
          render={<RoundButton icon="menu" label={copy.menu} size={40} aria-haspopup="menu" aria-expanded={menuOpen} />}
        />
        <BasePopover.Portal>
          <BasePopover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
            <BasePopover.Popup role="menu" aria-label={copy.menu} className="kit-pop ag-menu-pop">
              {profile && (
                <>
                  <MenuProfileRow
                    initials={initials(profile.fullName)}
                    name={profile.fullName}
                    subtitle={profile.code}
                    onClick={() => {
                      setMenuOpen(false)
                      setProfileOpen(true)
                    }}
                  />
                  <hr className="ag-hr" />
                </>
              )}
              <p className="ag-menu-label">{copy.language}</p>
              <LanguageSwitch language={language} className="ag-lsw" />
              <hr className="ag-hr" />
              <button
                type="button"
                role="menuitem"
                className="ag-menu-out"
                onClick={() => {
                  setMenuOpen(false)
                  setSignOutOpen(true)
                }}
              >
                <Icon name="signout" size={18} />
                <span>{account.signOut}</span>
              </button>
              <BasePopover.Close className="sr-only" tabIndex={-1}>
                {studentsCopy.close}
              </BasePopover.Close>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>

      {profile && (
        <Sheet
          open={profileOpen}
          onOpenChange={setProfileOpen}
          title={<ProfileHeader initials={initials(profile.fullName)} title={copy.profileTitle} />}
          closeLabel={studentsCopy.close}
          foot={
            profile.referralUrl ? (
              <Button size="wide" icon="copy" onClick={copyReferralLink}>
                {share.copy}
              </Button>
            ) : undefined
          }
        >
          <KeyValueList
            items={[
              { key: copy.fullName, value: profile.fullName },
              ...(profile.phone ? [{ key: copy.mobile, value: profile.phone }] : []),
              { key: studentsCopy.yourCode, value: <span className="ag-mono">{profile.code}</span> },
            ]}
          />
          {profile.referralUrl && (
            <>
              <p className="ag-profile-link-label">{share.linkLabel}</p>
              <p className="ag-link-box">{profile.referralUrl}</p>
            </>
          )}
        </Sheet>
      )}

      <Sheet
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title={copy.outQuestion}
        hint={copy.outBody}
        closeLabel={studentsCopy.close}
        foot={
          <>
            <form action={signOutLocalAndReturn} className="ag-signout-form">
              <input type="hidden" name="back" value="/auth" />
              <ConfirmSignOutButton label={account.signOut} />
            </form>
            <Button variant="ghost" size="wide" onClick={() => setSignOutOpen(false)}>
              {copy.stay}
            </Button>
          </>
        }
      >
        <div className="ag-signout-sheet-empty" />
      </Sheet>
    </>
  )
}

export function AgentsShell({
  language,
  limited,
  profile,
  recent,
  folded,
  sidebarWidth,
  children,
}: {
  language: Language
  limited: boolean
  profile: AgentsShellProfile | null
  recent: readonly AgentRecentChange[]
  folded: boolean
  sidebarWidth: number | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const copy = AGENTS_COPY[language]

  const items: ShellItem[] = [
    { href: "/home", label: copy.navHome, group: "", iconName: "school" },
    ...(limited ? [] : [{ href: "/students", label: copy.navStudents, group: "" as const, iconName: "applicants" as const }]),
  ]

  const currentHref = pathname.startsWith("/students") ? "/students" : "/home"
  const backFallbackHref = pathname.startsWith("/students/") ? "/students" : "/home"

  const topBar = (
    <>
      <TopBarHomeOrBack
        onHome={pathname === "/home"}
        homeHref="/home"
        homeLabel={copy.navHome}
        backLabel={copy.back}
        backFallbackHref={backFallbackHref}
      />
      {!limited && (
        <Suspense fallback={<AgentsSearchForm placeholder={copy.topSearch} query="" />}>
          <StudentsAwareSearch placeholder={copy.topSearch} />
        </Suspense>
      )}
      <span className="ns-spacer" />
      {!limited && <AgentsBell language={language} recent={recent} />}
      <AgentsMenu language={language} profile={profile} />
    </>
  )

  return (
    <NewShell
      shellApp="agents"
      lang={language}
      items={items}
      brandSubtitle={copy.codeTitle}
      navLabel={copy.menu}
      currentHref={currentHref}
      bell={null}
      canSearch={false}
      folded={folded}
      sidebarWidth={sidebarWidth}
      topBar={topBar}
    >
      {children}
    </NewShell>
  )
}
