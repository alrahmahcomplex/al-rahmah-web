import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { tanzaniaToday } from "@/lib/school-calendar"
import { countInvitedFamilies } from "@/lib/services/group-invitations"
import { listGroupLinks } from "@/lib/services/group-links"
import { createClient } from "@/utils/supabase/server"
import { requireStaff } from "../session"
import { familiesInvitedText, familiesWarning } from "./families-text"
import { LinkForm } from "./link-form"

export const metadata: Metadata = { title: "WhatsApp groups · Al-Rahmah Complex" }

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
  return <div className="flex flex-col gap-6">
    <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">WhatsApp groups</h1>
    <p className="max-w-xl text-sm text-muted-foreground">Save the admissions WhatsApp group link for each Enrollment year, even before its Fee schedule is ready.</p>
    <form action="/staff/group-links" className="flex max-w-sm flex-col gap-2" aria-label="Choose year">
      <Label htmlFor="group-year">Enrollment year</Label>
      <div className="flex gap-2"><Input id="group-year" name="year" defaultValue={requested ?? String(year)} required pattern="2\d{3}" inputMode="numeric" className="w-28" /><Button variant="outline" type="submit">Open year</Button></div>
    </form>
    {year === null ? <p role="alert" className="text-sm text-destructive">Enter an Enrollment year from 2000 to 2999.</p> : !links.ok ?
      <p role="alert" className="text-sm text-destructive">The group links could not be loaded. Reload the page to try again.</p> :
      <section aria-label={`Group ${year}`} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Admissions {year}</h2>
        {saved ? <div className="flex max-w-xl flex-col items-start gap-2">
          <p className="break-all text-sm">{saved.url}</p>
          <p className="text-sm text-muted-foreground">Set by {saved.setByName} on <time dateTime={saved.setAt}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(saved.setAt))}</time> (Tanzania)</p>
          <a href={saved.url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Open to test</a>
        </div> : <p className="text-sm text-muted-foreground">No group link saved for {year} yet.</p>}
        {families && (families.ok ? <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm">{familiesInvitedText(families.data)}</p>
          {warning && <p role="alert" className="text-sm font-medium text-amber-700">{warning}</p>}
        </div> : <p role="alert" className="text-sm text-destructive">The families invited could not be counted. Reload the page to try again.</p>)}
        {staff.permissions.includes("group_links.manage") && <LinkForm key={year} year={year} saved={saved?.url ?? null} />}
      </section>}
    {links.ok && links.data.length > 0 && <nav aria-label="Saved group years" className="flex flex-wrap gap-4">{links.data.map((link) => <Link key={link.year} href={`/staff/group-links?year=${link.year}`} className="text-sm underline underline-offset-4">{link.year}</Link>)}</nav>}
  </div>
}
