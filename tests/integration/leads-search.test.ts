import { randomBytes, randomInt } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  createLead,
  LEADS_PER_PAGE,
  searchLeads,
  type LeadClosure,
  type LeadListItem,
  type LeadStatus,
} from "@/lib/services/leads"

import { anonClient, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Lead search and the lead list, through the lead module against local
// Supabase. The local database keeps every lead earlier runs made, so each
// test names its own leads with a token nobody else uses, and checks only
// what holds however many other leads exist.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function token() {
  // Ten random letters, so no Admission Number, other test's name or earlier
  // run's lead contains it.
  return `Srch${Array.from(randomBytes(10), (byte) => String.fromCharCode(97 + (byte % 26))).join("")}`
}

async function makeLead(fullName: string) {
  const staff = await signedIn(ADMISSIONS)
  const created = await createLead(staff, {
    guardian: {
      contact: {
        fullName: "Search Parent",
        relationship: "Father",
        phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
      },
    },
    student: { fullName, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Boarding" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`Could not create ${fullName}: ${JSON.stringify(created.error)}`)
  return created.data
}

// Nothing in this slice closes or declines a lead, so tests set the state the
// way a later slice's function would, as the system.
async function setState(leadId: string, state: { status?: LeadStatus; closure?: LeadClosure | null }) {
  await asSystem(async (sql) => {
    // A Declined lead carries its reason (#97).
    if (state.status) {
      await sql.query(
        "update public.leads set status = $2::public.lead_status, declined_reason = case when $2::public.lead_status = 'Declined' then 'School decision'::public.declined_reason end where id = $1",
        [leadId, state.status],
      )
    }
    if (state.closure !== undefined) {
      await sql.query("update public.leads set closure = $2 where id = $1", [leadId, state.closure])
    }
  })
}

async function search(input: Parameters<typeof searchLeads>[1], person = ADMISSIONS) {
  const result = await searchLeads(await signedIn(person), input)
  if (!result.ok) throw new Error(`Search failed: ${result.error}`)
  return result.data
}

const names = (leads: LeadListItem[]) => leads.map((lead) => lead.studentName)

describe("searching by Admission Number", () => {
  test("finds a closed lead exactly, whatever the filters say", async () => {
    // Hamisi is Archived.
    for (const query of ["ADMSN-90005", "  admsn-90005 ", "90005"]) {
      const found = await search({ query, status: "Applied", closure: "open", page: 1 })
      expect(found.mode).toBe("number")
      expect(found.leads).toEqual([
        {
          id: "1ead0000-0000-4000-8000-000000000005",
          admissionNumber: "ADMSN-90005",
          studentName: "Hamisi Fixture",
          className: "STD 5",
          enrollmentYear: 2027,
          dayOrBoarding: "Day",
          status: "Visited",
          closure: "Archived",
          returningFamily: false,
          createdAt: expect.any(String),
        },
      ])
      expect(found.total).toBe(1)
    }
  })

  test("finds a Declined lead, and a number that matches nothing finds nothing", async () => {
    expect(names((await search({ query: "90006", page: 1 })).leads)).toEqual(["Rehema Fixture"])

    const none = await search({ query: "ADMSN-00000", page: 1 })
    expect(none.mode).toBe("number")
    expect(none.leads).toEqual([])
    expect(none.total).toBe(0)
  })

  test("shows the Returning family badge", async () => {
    // Neema joined her brother's Family.
    const [neema] = (await search({ query: "90003", page: 1 })).leads
    expect(neema.returningFamily).toBe(true)
  })
})

describe("searching by name", () => {
  test("matches any part of the name, ignoring case and spacing", async () => {
    const t = token()
    const created = await makeLead(`${t} Amina Juma`)

    for (const query of [`${t} amina juma`, `  ${t.toUpperCase()}   AMINA  `, `${t}  aMINA   JUMA`]) {
      const found = await search({ query, page: 1 })
      expect(found.mode, query).toBe("name")
      expect(found.leads.map((lead) => lead.id), query).toContain(created.leadId)
    }

    // Part of the name, from the middle.
    const middle = await search({ query: `${t.slice(2)} amina ju`, page: 1 })
    expect(middle.leads.map((lead) => lead.id)).toEqual([created.leadId])
  })

  test("characters that mean something in a pattern are matched as themselves", async () => {
    const t = token()
    const juma = await makeLead(`${t} Juma`)
    for (const query of [
      `${t}%`,
      `${t}_`,
      `${t}*`,
      `${t.slice(0, 5)}*${t.slice(6)}`,
      `${t.slice(0, 5)}.${t.slice(6)}`,
      `${t}\\`,
      `${t} (Juma`,
      `${t} [J]uma`,
    ]) {
      expect((await search({ query, page: 1 })).leads, query).toEqual([])
    }

    // A name that really has them is found by them.
    const odd = await makeLead(`${t} O'Neil* (Jr.) [2]`)
    expect((await search({ query: `${t.slice(3)} o'neil* (jr.) [2`, page: 1 })).leads.map((lead) => lead.id)).toEqual([odd.leadId])
    expect((await search({ query: t, page: 1 })).leads.map((lead) => lead.id)).toEqual([juma.leadId, odd.leadId])

    // An asterisk never turns a number into another lead's number, or a
    // lone asterisk into a list of everyone.
    expect((await search({ query: "90*005", page: 1 })).leads).toEqual([])
    const star = await search({ query: "*", page: 1 })
    expect(star.mode).toBe("name")
    expect(star.leads.every((lead) => lead.studentName.includes("*"))).toBe(true)
  })

  test("lists leads without a closure mark first, Declined among them by name, then closed leads, badged", async () => {
    const t = token()
    const echo = await makeLead(`${t} Echo`)
    const alpha = await makeLead(`${t} Alpha`)
    const charlie = await makeLead(`${t} Charlie`)
    const bravo = await makeLead(`${t} Bravo`)
    const delta = await makeLead(`${t} Delta`)
    await setState(bravo.leadId, { status: "Declined" })
    await setState(charlie.leadId, { closure: "Archived" })
    await setState(delta.leadId, { closure: "Inactive" })

    // The filters are for the list; a name search ignores them.
    const found = await search({ query: t.toLowerCase(), status: "Applied", closure: "open", page: 1 })
    expect(found.leads.map((lead) => [lead.studentName, lead.status, lead.closure])).toEqual([
      [`${t} Alpha`, "Visited", null],
      [`${t} Bravo`, "Declined", null],
      [`${t} Echo`, "Visited", null],
      [`${t} Delta`, "Visited", "Inactive"],
      [`${t} Charlie`, "Visited", "Archived"],
    ])
    expect(found.total).toBe(5)
    expect(new Set(found.leads.map((lead) => lead.id))).toEqual(
      new Set([alpha, bravo, charlie, delta, echo].map((lead) => lead.leadId)),
    )
  })

  test("pages through many matches, 50 at a time", async () => {
    const t = token()
    const created: string[] = []
    for (let batch = 0; batch < 6; batch++) {
      const made = await Promise.all(
        Array.from({ length: batch < 5 ? 10 : 1 }, (_, i) => makeLead(`${t} Child ${batch * 10 + i}`)),
      )
      created.push(...made.map((lead) => lead.leadId))
    }
    expect(LEADS_PER_PAGE).toBe(50)

    const first = await search({ query: t, page: 1 })
    const second = await search({ query: t, page: 2 })
    expect(first.leads).toHaveLength(50)
    expect(second.leads).toHaveLength(1)
    expect([first.total, first.pageCount, second.page]).toEqual([51, 2, 2])
    expect(new Set([...first.leads, ...second.leads].map((lead) => lead.id))).toEqual(new Set(created))

    // A page past the end is empty, not an error.
    const past = await search({ query: t, page: 3 })
    expect([past.leads, past.total, past.pageCount]).toEqual([[], 51, 2])

    // So is a page far past any real list.
    const far = await search({ query: t, page: 1e308 })
    expect([far.leads, far.total, far.pageCount]).toEqual([[], 51, 2])
  })
})

describe("the lead list, with no search term", () => {
  test("shows leads without a closure mark, newest first", async () => {
    const t = token()
    const archived = await makeLead(`${t} Archived`)
    await setState(archived.leadId, { closure: "Archived" })
    const older = await makeLead(`${t} Older`)
    const newer = await makeLead(`${t} Newer`)

    for (const query of [undefined, "", "   "]) {
      const list = await search({ query, page: 1 })
      expect(list.mode).toBe("list")
      expect(list.leads.every((lead) => lead.closure === null)).toBe(true)
      const ids = list.leads.map((lead) => lead.id)
      expect(ids).not.toContain(archived.leadId)
      expect(ids.indexOf(newer.leadId)).toBeGreaterThanOrEqual(0)
      expect(ids.indexOf(newer.leadId)).toBeLessThan(ids.indexOf(older.leadId))
      const times = list.leads.map((lead) => Date.parse(lead.createdAt))
      expect(times).toEqual([...times].sort((a, b) => b - a))
    }
  })

  test("filters by closure mark and by status", async () => {
    const t = token()
    const open = await makeLead(`${t} Open`)
    const inactive = await makeLead(`${t} Inactive`)
    const archived = await makeLead(`${t} Archived`)
    const declined = await makeLead(`${t} Declined`)
    // Enrolled, which only this test sets, keeps the list short enough that
    // these leads are on the first page.
    for (const lead of [open, inactive, archived]) await setState(lead.leadId, { status: "Enrolled" })
    await setState(inactive.leadId, { closure: "Inactive" })
    await setState(archived.leadId, { closure: "Archived" })
    await setState(declined.leadId, { status: "Declined" })

    const ids = async (input: Parameters<typeof searchLeads>[1]) => {
      const list = await search(input)
      return { ids: list.leads.map((lead) => lead.id), leads: list.leads }
    }

    const byDefault = await ids({ status: "Enrolled", page: 1 })
    expect(byDefault.ids).toContain(open.leadId)
    expect(byDefault.ids).not.toContain(inactive.leadId)
    expect(byDefault.ids).not.toContain(archived.leadId)
    expect(byDefault.leads.every((lead) => lead.status === "Enrolled" && lead.closure === null)).toBe(true)

    const onlyInactive = await ids({ status: "Enrolled", closure: "Inactive", page: 1 })
    expect(onlyInactive.ids).toContain(inactive.leadId)
    expect(onlyInactive.leads.every((lead) => lead.closure === "Inactive")).toBe(true)

    const onlyArchived = await ids({ status: "Enrolled", closure: "Archived", page: 1 })
    expect(onlyArchived.ids).toContain(archived.leadId)
    expect(onlyArchived.leads.every((lead) => lead.closure === "Archived")).toBe(true)

    const all = await ids({ status: "Enrolled", closure: "all", page: 1 })
    for (const lead of [open, inactive, archived]) expect(all.ids).toContain(lead.leadId)

    const declinedList = await ids({ status: "Declined", page: 1 })
    expect(declinedList.ids).toContain(declined.leadId)
    expect(declinedList.leads.every((lead) => lead.status === "Declined")).toBe(true)

    const visited = await ids({ status: "Visited", closure: "all", page: 1 })
    expect(visited.leads.every((lead) => lead.status === "Visited")).toBe(true)
  })

  test("pages 50 at a time, keeping the filters", async () => {
    // Make sure there is a second page of Visited leads without a mark.
    const t = token()
    for (let batch = 0; batch < 6; batch++) {
      await Promise.all(Array.from({ length: 10 }, (_, i) => makeLead(`${t} Page ${batch * 10 + i}`)))
    }

    // Leads other tests add between the two reads would push page one's tail
    // onto page two, so new leads wait until both pages are read.
    const [first, second] = await inRolledBackTransaction(async (sql) => {
      await sql.query("lock table public.leads in share mode")
      return [await search({ status: "Visited", page: 1 }), await search({ status: "Visited", page: 2 })]
    })
    expect(first.leads).toHaveLength(50)
    expect(second.page).toBe(2)
    expect(second.leads.length).toBeGreaterThan(0)
    expect(first.pageCount).toBeGreaterThanOrEqual(2)
    for (const lead of [...first.leads, ...second.leads]) {
      expect(lead.status).toBe("Visited")
      expect(lead.closure).toBeNull()
    }
    // Page two carries on from page one.
    expect(Date.parse(second.leads[0].createdAt)).toBeLessThanOrEqual(Date.parse(first.leads[49].createdAt))
  })
})

describe("who may search", () => {
  test("an Accountant and an Admissions Manager can search", async () => {
    for (const person of [ACCOUNTANT, MANAGER]) {
      expect(names((await search({ query: "90002", page: 1 }, person)).leads)).toEqual(["Baraka Fixture"])
      expect(names((await search({ query: "Baraka Fixture", page: 1 }, person)).leads)).toContain("Baraka Fixture")
    }
  })

  test("someone signed out finds nothing", async () => {
    for (const query of ["90002", "Fixture", undefined]) {
      const result = await searchLeads(anonClient(), { query, page: 1 })
      expect(result.ok && result.data.leads, String(query)).toEqual([])
    }
  })
})
