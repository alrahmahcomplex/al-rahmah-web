"use client"

import { useState } from "react"

import {
  Button,
  Card,
  CodeChip,
  FilterMenu,
  KeyValueList,
  ListRow,
  MenuProfileRow,
  ProfileHeader,
  Sheet,
  StepTrack,
  TopBarHomeOrBack,
  toast,
} from "@/components/kit"

import { useDesignHref } from "../design-href"

// Kit parts introduced for the agents app (#539, prototype v5). Every part is
// built in components/kit/ and showcased here before any screen uses it
// (DESIGN.md, The Kit First Rule). Fixture data only. Links stay on the
// Design system page, wherever it is served.

const FILTER_OPTIONS = [
  { value: "all", label: "All", count: 24 },
  { value: "Applied", label: "Applied", count: 8 },
  { value: "Visited", label: "Visited", count: 4 },
  { value: "Interviewed", label: "Interviewed", count: 5 },
  { value: "Enrolled", label: "Enrolled", count: 4 },
  { value: "Declined", label: "Declined", count: 3 },
  { value: "Empty", label: "With none", count: 0, disabled: true },
] as const

const DEMO_STEPS = [
  { label: "Applied", state: "done" },
  { label: "Visited", state: "done" },
  { label: "Interviewed", state: "current" },
  { label: "Enrolled", state: "upcoming" },
] as const

export function FilterMenuCard() {
  const [step, setStep] = useState("all")
  const current = FILTER_OPTIONS.find((o) => o.value === step) ?? FILTER_OPTIONS[0]
  return (
    <Card id="filter-menu" title="Filter menu with counts">
      <div className="kp-rowx">
        <FilterMenu label="Filter" currentLabel={current.label} value={step} active={step !== "all"} options={FILTER_OPTIONS} onSelect={setStep} />
        <p className="kp-spec">
          Showing: <b>{current.label}</b> ({current.count})
        </p>
      </div>
      <p className="kp-spec">
        A 40px round filter button with an orange dot pip while a filter is active. Opens a radio menu with counts and a check mark; zero-count items stay visible and disabled.
      </p>
    </Card>
  )
}

export function CodeChipCard() {
  return (
    <Card id="code-chip" title="Code chip with copy">
      <div className="kp-rowx">
        <CodeChip
          code="ABC-123"
          prefix="Your code"
          copyValue="https://alrahmahcomplex.or.tz/apply?ref=ABC-123"
          copyLabel="Copy link"
          copiedMessage="Link copied"
          copyFailedMessage="Could not copy"
        />
      </div>
      <p className="kp-spec">Outlined pill carrying the monospace Discount code and a round copy button that copies the referral link.</p>
    </Card>
  )
}

export function TopBarSwapCard() {
  const page = useDesignHref("")
  const [onHome, setOnHome] = useState(true)
  return (
    <Card id="top-bar-swap" title="Top bar logo and back swap">
      <div className="kp-rowx">
        <TopBarHomeOrBack onHome={onHome} homeHref={page} homeLabel="Home" backLabel="Back" phoneOnlyLogo={false} onBack={() => setOnHome(true)} />
        <Button variant="ghost" size="small" onClick={() => setOnHome((v) => !v)}>
          {onHome ? "Show Back button" : "Show Home logo"}
        </Button>
      </div>
      <p className="kp-spec">On Home, a 40px round logo link (hidden on wide screens when the sidebar shows it); on every other page, a 40px Back button.</p>
    </Card>
  )
}

export function ProfileRowCard() {
  const [profileOpen, setProfileOpen] = useState(false)
  return (
    <Card id="profile-row" title="Menu profile row and profile sheet">
      <div role="menu" aria-label="Account preview">
        <MenuProfileRow initials="AK" name="Amina Kassim" subtitle="ABC-123" onClick={() => setProfileOpen(true)} />
      </div>
      <p className="kp-spec">Tap the profile row to open the Profile sheet with key-value details and the referral link.</p>
      <Sheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        title={<ProfileHeader initials="AK" title="Your profile" />}
        closeLabel="Close"
        foot={
          <Button
            size="wide"
            icon="copy"
            onClick={() => {
              setProfileOpen(false)
              toast("Link copied", { tone: "good" })
            }}
          >
            Copy link
          </Button>
        }
      >
        <KeyValueList
          items={[
            { key: "Full name", value: "Amina Kassim" },
            { key: "Mobile number", value: "0712 345 123" },
            { key: "Your code", value: <code>ABC-123</code> },
          ]}
        />
      </Sheet>
    </Card>
  )
}

export function StepTrackCard() {
  return (
    <Card id="step-track" title="Vertical step track">
      <StepTrack label="Student progress" steps={DEMO_STEPS} />
      <p className="kp-spec">Completed steps hold a green check; the current step highlights in orange; upcoming steps stay muted.</p>
    </Card>
  )
}

export function LinkRowsCard() {
  const page = useDesignHref("")
  return (
    <Card id="link-rows" title="Link-row list">
      <ListRow inset icon="followups" title="Faraji Juma Mwita · STD 3" caption="Remind the family about the interview." href={page} />
      <ListRow inset title="Asha Hamisi Ally" caption="FORM 1 · Interviewed" href={page} />
      <p className="kp-spec">Whole rows act as links with a right chevron and inset hover pill, with no per-row buttons.</p>
    </Card>
  )
}
