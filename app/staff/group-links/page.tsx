import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"
import { Button, Card, EmptyState, Field, Note, PageHeader, pageTitle } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import { countInvitedFamilies } from "@/lib/services/group-invitations"
import { listGroupLinks } from "@/lib/services/group-links"
import { createClient } from "@/utils/supabase/server"
import { requireStaff } from "../session"
import { familiesInvitedText, familiesWarning } from "./families-text"
import { LinkForm } from "./link-form"
import "../agents/agents.css"

export const metadata: Metadata = { title: pageTitle("WhatsApp groups") }

export default async function GroupLinksPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()
  const { year: requested } = await searchParams
  const year = requested === undefined ? Number(tanzaniaToday().slice(0, 4)) + 1 : /^2\d{3}$/.test(requested) ? Number(requested) : null
  const supabase = await createClient()
  const [links, families] = await Promise.all([
    listGroupLinks(supabase),
    year === null ? null : countInvitedFamilies(supabase, year),
  ])
  const warning = families?.ok ? familiesWarning(families.data) : null
  const saved = links.ok ? links.data.find((link) => link.year === year) : null
  return <div className="ag-page">
    <PageHeader title="WhatsApp groups" subtitle="Save the admissions WhatsApp group link for each Enrollment year, even before its Fee schedule is ready." />
    <form action="/staff/group-links" className="ag-field ag-year" aria-label="Choose year">
      <label htmlFor="group-year" className="ag-label">Enrollment year</label>
      <div className="ag-row"><Field id="group-year" name="year" size="compact" defaultValue={requested ?? String(year)} required pattern="2\d{3}" inputMode="numeric" /><Button variant="ghost" type="submit">Open year</Button></div>
    </form>
    {year === null ? <p role="alert" className="ag-error">Enter an Enrollment year from 2000 to 2999.</p> : !links.ok ?
      <p role="alert" className="ag-error">The group links could not be loaded. Reload the page to try again.</p> :
      <Card aria-label={`Group ${year}`}>
        <h2 className="kit-card-title">Admissions {year}</h2>
        <div className="ag-card-body ag-narrow">
          {saved ? <div className="ag-cell">
            <p className="ag-p ag-wrap">{saved.url}</p>
            <p className="ag-p ag-quiet">Set by {saved.setByName} on <time dateTime={saved.setAt}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(saved.setAt))}</time> (Tanzania)</p>
            <a href={saved.url} target="_blank" rel="noopener noreferrer" className="ag-link">Open to test</a>
          </div> : <EmptyState title={`No group link saved for ${year} yet.`} />}
          {families && (families.ok ? <div className="ag-stack">
            <p className="ag-p">{familiesInvitedText(families.data)}</p>
            {warning && <Note tone="wait" role="alert">{warning}</Note>}
          </div> : <p role="alert" className="ag-error">The families invited could not be counted. Reload the page to try again.</p>)}
          {staff.permissions.includes("group_links.manage") && <LinkForm key={year} year={year} saved={saved?.url ?? null} />}
        </div>
      </Card>}
    {links.ok && links.data.length > 0 && <nav aria-label="Saved group years" className="ag-row ag-years">{links.data.map((link) => <Link key={link.year} href={`/staff/group-links?year=${link.year}`} className="ag-link">{link.year}</Link>)}</nav>}
  </div>
}
