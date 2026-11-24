import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAgentStudent, getAgentStudents } from "@/lib/services/agent-students"
import { setAgentDiscount } from "@/lib/services/discount-codes"
import { changeAgentStatus } from "@/lib/services/marketing-agents"

import { agentWithLogin, studentInterview, studentLead, tanzaniaDaysAgo } from "../support/agent-students"
import { anonClient, inRolledBackTransaction, signedIn } from "../support/db"
import { MANAGER, SEEDED_AGENT } from "../support/fixtures"

// The students using an agent's Discount code (#195) against local Supabase.
// Every agent and lead here is the test's own, with invented names, numbers
// and example.test emails.

async function asUser<T>(sql: Client, userId: string, query: string): Promise<T[]> {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })])
  await sql.query("set local role authenticated")
  try {
    return (await sql.query(query)).rows as T[]
  } finally {
    await sql.query("reset role")
  }
}

describe("the students using an agent's Discount code", () => {
  test("only the agent's own leads come back, newest first, with only the allowed fields", async () => {
    const agent = await agentWithLogin()
    const other = await agentWithLogin()
    await studentLead({ name: "Amina Wangu", code: agent.code, createdAt: "2026-09-01 09:00+03" })
    await studentLead({ name: "Baraka Wangu", code: agent.code, status: "Visited", createdAt: "2026-09-02 09:00+03" })
    await studentLead({ name: "Siyo Wangu", code: other.code })

    const result = await getAgentStudents(await signedIn(agent), { search: "", limit: 20, offset: 0 })
    expect(result).toEqual({
      ok: true,
      data: {
        kind: "active",
        code: agent.code,
        phone: expect.stringMatching(/^\+255/),
        total: 2,
        matched: 2,
        students: [
          {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
            name: "Baraka Wangu",
            className: "STD 3",
            status: "Visited",
            notActive: false,
            lastChange: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            declinedReason: null,
            interviewRegistered: false,
            result: null,
          },
          expect.objectContaining({ name: "Amina Wangu", status: "Applied" }),
        ],
        steps: { Applied: 1, Visited: 1, Interviewed: 0, Enrolled: 0, Declined: 0 },
        reminders: expect.any(Array),
        recent: expect.any(Array),
        discount: 10000,
      },
    })

    // Searching for the other agent's student finds nothing.
    const probed = await getAgentStudents(await signedIn(agent), { search: "Siyo Wangu", limit: 20, offset: 0 })
    expect(probed).toMatchObject({ ok: true, data: { total: 2, matched: 0, students: [] } })
  })

  test("the raw function returns only allowed fields (with opaque UUID id) and no contact, note, or amount", async () => {
    const agent = await agentWithLogin()
    const id = await studentLead({ name: "Declined Wangu", code: agent.code, status: "Declined", closure: "Archived" })
    await studentInterview(id, { result: "Failed", score: 31.5, paid: true, registeredAt: "2026-09-05 09:00+03" })

    const { data, error } = await (await signedIn(agent)).rpc("agent_students", { search: null, page_limit: 20, page_offset: 0 })
    expect(error).toBeNull()
    const student = (data as { students: Record<string, unknown>[] }).students[0]
    expect(Object.keys(student).sort()).toEqual([
      "class_name",
      "declined_reason",
      "id",
      "interview_registered",
      "interview_result",
      "interview_score",
      "last_change",
      "not_active",
      "status",
      "student_name",
    ])
    expect(student).toMatchObject({
      id,
      status: "Declined",
      not_active: true,
      declined_reason: "Did not pass interview",
      interview_result: "Failed",
      interview_score: 31.5,
    })
    expect(JSON.stringify(data)).not.toMatch(/Staff-only explanation|Mzazi|\+2556|50000|Family requested closure/)
  })

  test("the result and score stay hidden until the interview fee is Paid, and a retake shows the latest", async () => {
    const agent = await agentWithLogin()
    const unpaid = await studentLead({ name: "Unpaid Wangu", code: agent.code, status: "Interviewed", createdAt: "2026-09-01 09:00+03" })
    await studentInterview(unpaid, { result: "Passed", score: 88, paid: false, registeredAt: "2026-09-05 09:00+03" })
    const retaken = await studentLead({ name: "Retaken Wangu", code: agent.code, status: "Interviewed", createdAt: "2026-09-02 09:00+03" })
    await studentInterview(retaken, { result: "Failed", score: 40, paid: true, registeredAt: "2026-09-03 09:00+03" })
    await studentInterview(retaken, { result: "Passed", score: 72.5, paid: true, registeredAt: "2026-09-20 09:00+03" })

    // An earlier interview was Paid, but the latest isn't yet: nothing shows.
    const retakeUnpaid = await studentLead({ name: "Retake Unpaid Wangu", code: agent.code, status: "Interviewed", createdAt: "2026-09-03 09:00+03" })
    await studentInterview(retakeUnpaid, { result: "Passed", score: 65, paid: true, registeredAt: "2026-09-03 09:00+03" })
    await studentInterview(retakeUnpaid, { result: "Failed", score: 20, paid: false, registeredAt: "2026-09-21 09:00+03" })

    const result = await getAgentStudents(await signedIn(agent), { search: "", limit: 20, offset: 0 })
    if (!result.ok || result.data.kind !== "active") throw new Error(JSON.stringify(result))
    const byName = Object.fromEntries(result.data.students.map((s) => [s.name, s]))
    expect(byName["Unpaid Wangu"]).toMatchObject({ interviewRegistered: true, result: null })
    expect(byName["Retaken Wangu"]).toMatchObject({ interviewRegistered: true, result: { outcome: "Passed", score: 72.5 } })
    expect(byName["Retake Unpaid Wangu"]).toMatchObject({ interviewRegistered: true, result: null })
  })

  test("the last change is the newest recorded change to the lead, as a Tanzanian date", async () => {
    const agent = await agentWithLogin()
    // Created long ago, but recorded (and so last changed) today.
    await studentLead({ name: "Changed Wangu", code: agent.code, createdAt: "2026-01-10 09:00+03" })
    const today = await inRolledBackTransaction(async (sql) => (await sql.query<{ d: string }>("select public.tanzania_today()::text as d")).rows[0].d)
    const result = await getAgentStudents(await signedIn(agent), { search: "", limit: 20, offset: 0 })
    expect(result).toMatchObject({ ok: true, data: { students: [{ name: "Changed Wangu", lastChange: today }] } })
    expect(today).not.toBe("2026-01-10")
  })

  test("it pages by creation with the total in the same call, and searches by name", async () => {
    const agent = await agentWithLogin()
    for (let day = 1; day <= 5; day++) {
      await studentLead({ name: `Mtoto ${day} Paging`, code: agent.code, createdAt: `2026-08-0${day} 09:00+03` })
    }
    const client = await signedIn(agent)

    const first = await getAgentStudents(client, { search: "", limit: 2, offset: 0 })
    const second = await getAgentStudents(client, { search: "", limit: 2, offset: 2 })
    expect(first).toMatchObject({ ok: true, data: { total: 5, matched: 5 } })
    if (!first.ok || first.data.kind !== "active" || !second.ok || second.data.kind !== "active") throw new Error("not active")
    expect(first.data.students.map((s) => s.name)).toEqual(["Mtoto 5 Paging", "Mtoto 4 Paging"])
    expect(second.data.students.map((s) => s.name)).toEqual(["Mtoto 3 Paging", "Mtoto 2 Paging"])

    const searched = await getAgentStudents(client, { search: "  mtoto 3 ", limit: 20, offset: 0 })
    expect(searched).toMatchObject({ ok: true, data: { total: 5, matched: 1, students: [{ name: "Mtoto 3 Paging" }] } })
  })

  test("a page outside 1 to 200 rows is refused", async () => {
    const agent = await agentWithLogin()
    const { error } = await (await signedIn(agent)).rpc("agent_students", { search: null, page_limit: 201, page_offset: 0 })
    expect(error?.message).toBe("invalid")
  })

  test("a still-valid token after switch-off gets the state and no data, and after Retire nothing", async () => {
    const agent = await agentWithLogin()
    await studentLead({ name: "Hidden Wangu", code: agent.code })
    const client = await signedIn(agent)
    expect(await getAgentStudents(client, { search: "", limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { kind: "active", total: 1 } })

    expect((await changeAgentStatus(await signedIn(MANAGER), agent.id, "switch-off", "Left the school")).ok).toBe(true)
    const off = await client.rpc("agent_students", { search: null, page_limit: 20, page_offset: 0 })
    expect(off).toMatchObject({ error: null, data: { state: "switched_off" } })
    expect(Object.keys(off.data as object)).toEqual(["state"])
    expect(await getAgentStudents(client, { search: "", limit: 20, offset: 0 })).toEqual({ ok: true, data: { kind: "switched-off" } })

    // Retiring detaches the login, so the same token no longer names an agent
    // at all and reads nothing.
    expect((await changeAgentStatus(await signedIn(MANAGER), agent.id, "retire", "Created wrongly")).ok).toBe(true)
    expect(await client.rpc("agent_students", { search: null, page_limit: 20, page_offset: 0 })).toMatchObject({ error: null, data: null })
  })

  test("with agent access off, the agent gets only the state", async () => {
    const agent = await agentWithLogin()
    await studentLead({ name: "Paused Wangu", code: agent.code })
    const userId = (await signedIn(agent).then((c) => c.auth.getUser())).data.user?.id
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      const rows = await asUser<{ r: unknown }>(sql, userId!, "select public.agent_students(null, 20, 0) as r")
      expect(rows).toEqual([{ r: { state: "access_off" } }])
    })
  })

  test("staff and visitors get nothing", async () => {
    expect(await getAgentStudents(await signedIn(MANAGER), { search: "", limit: 20, offset: 0 })).toEqual({ ok: false, error: "not-agent" })
    const visitor = await anonClient().rpc("agent_students", { search: null, page_limit: 20, page_offset: 0 })
    expect(visitor.error?.code).toBe("42501")
  })

  test("direct selects on leads, interviews and the audit log return nothing to the agent", async () => {
    const agent = await agentWithLogin()
    const id = await studentLead({ name: "Direct Wangu", code: agent.code, status: "Interviewed" })
    await studentInterview(id, { result: "Passed", score: 90, paid: true, registeredAt: "2026-09-05 09:00+03" })
    const client = await signedIn(agent)
    for (const table of ["leads", "interviews", "audit_log", "guardian_contacts"]) {
      const { data } = await client.from(table).select("*").limit(5)
      expect(data ?? []).toEqual([])
    }
    // The staff lead count gives an agent nothing either.
    const { data: counted } = await client.from("marketing_agents").select("lead_count").eq("id", agent.id)
    expect(counted ?? []).toEqual([])
  })

  test("the seeded agent's list is empty", async () => {
    expect(await getAgentStudents(await signedIn(SEEDED_AGENT), { search: "", limit: 20, offset: 0 })).toEqual({
      ok: true,
      data: {
        kind: "active",
        code: SEEDED_AGENT.code,
        phone: "+255700000403",
        total: 0,
        matched: 0,
        students: [],
        steps: { Applied: 0, Visited: 0, Interviewed: 0, Enrolled: 0, Declined: 0 },
        reminders: [],
        recent: [],
        discount: 10000,
      },
    })
  })
})

// The dashboard (#497): counts per step, who could use a reminder after the
// owner's waiting days (14 after applying, 14 after the visit, 7 after a
// Paid, Passed interview), one step at a time, and the code's amount.
describe("the agent dashboard's answer", () => {
  const at = (days: number) => `${tanzaniaDaysAgo(days)} 09:00+03`

  test("counts every student by step and lists who has waited long enough, the longest first", async () => {
    const agent = await agentWithLogin()
    const other = await agentWithLogin()
    const code = agent.code
    await studentLead({ name: "Applied Fourteen", code, createdAt: at(14) })
    await studentLead({ name: "Applied Thirteen", code, createdAt: at(13) })
    await studentLead({ name: "Applied Closed", code, createdAt: at(40), closure: "Inactive" })
    await studentLead({ name: "Visited Twenty", code, status: "Visited", createdAt: at(30), visitDate: tanzaniaDaysAgo(20) })
    await studentLead({ name: "Visited Ten", code, status: "Visited", createdAt: at(30), visitDate: tanzaniaDaysAgo(10) })
    const passed = await studentLead({ name: "Passed Seven", code, status: "Interviewed", createdAt: at(30), visitDate: tanzaniaDaysAgo(25) })
    await studentInterview(passed, { result: "Passed", score: 80, paid: true, registeredAt: at(9), interviewDate: tanzaniaDaysAgo(7) })
    const recent = await studentLead({ name: "Passed Six", code, status: "Interviewed", createdAt: at(30), visitDate: tanzaniaDaysAgo(25) })
    await studentInterview(recent, { result: "Passed", score: 80, paid: true, registeredAt: at(9), interviewDate: tanzaniaDaysAgo(6) })
    const unpaid = await studentLead({ name: "Passed Unpaid", code, status: "Interviewed", createdAt: at(30), visitDate: tanzaniaDaysAgo(25) })
    await studentInterview(unpaid, { result: "Passed", score: 80, paid: false, registeredAt: at(20), interviewDate: tanzaniaDaysAgo(20) })
    const failed = await studentLead({ name: "Failed Twenty", code, status: "Interviewed", createdAt: at(30), visitDate: tanzaniaDaysAgo(25) })
    await studentInterview(failed, { result: "Failed", score: 20, paid: true, registeredAt: at(20), interviewDate: tanzaniaDaysAgo(20) })
    await studentLead({ name: "Enrolled Long", code, status: "Enrolled", createdAt: at(90), visitDate: tanzaniaDaysAgo(80) })
    await studentLead({ name: "Declined Long", code, status: "Declined", createdAt: at(90), visitDate: tanzaniaDaysAgo(80) })
    await studentLead({ name: "Someone Else", code: other.code, createdAt: at(60) })

    const result = await getAgentStudents(await signedIn(agent), { search: "", limit: 1, offset: 0 })
    if (!result.ok || result.data.kind !== "active") throw new Error(JSON.stringify(result))
    // Counts and reminders cover the whole list, whatever the page.
    expect(result.data.students).toHaveLength(1)
    expect(result.data.steps).toEqual({ Applied: 3, Visited: 2, Interviewed: 4, Enrolled: 1, Declined: 1 })
    expect(result.data.reminders).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), name: "Visited Twenty", className: "STD 3", step: "Visited", days: 20 },
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), name: "Applied Fourteen", className: "STD 3", step: "Applied", days: 14 },
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), name: "Passed Seven", className: "STD 3", step: "Interviewed", days: 7 },
    ])
  })

  test("a reminder looks at the latest interview only, and counts days in Tanzanian dates", async () => {
    const agent = await agentWithLogin()
    const code = agent.code
    // An older interview was Passed and Paid, but the latest (a retake) is unpaid: no reminder.
    const retake = await studentLead({ name: "Retake Latest", code, status: "Interviewed", createdAt: at(40), visitDate: tanzaniaDaysAgo(35) })
    await studentInterview(retake, { result: "Passed", score: 80, paid: true, registeredAt: at(30), interviewDate: tanzaniaDaysAgo(30) })
    await studentInterview(retake, { result: "Failed", score: 30, paid: false, registeredAt: at(10), interviewDate: tanzaniaDaysAgo(10) })
    // Applied 13 Tanzanian days ago at 01:00, which is the day before in UTC: 13 days, no reminder.
    await studentLead({ name: "Applied Early Morning", code, createdAt: `${tanzaniaDaysAgo(13)} 01:00+03` })
    // And 14 days ago at 23:30 Tanzanian time: 14 days, a reminder.
    await studentLead({ name: "Applied Late Night", code, createdAt: `${tanzaniaDaysAgo(14)} 23:30+03` })

    const result = await getAgentStudents(await signedIn(agent), { search: "", limit: 20, offset: 0 })
    if (!result.ok || result.data.kind !== "active") throw new Error(JSON.stringify(result))
    expect(result.data.reminders).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), name: "Applied Late Night", className: "STD 3", step: "Applied", days: 14 },
    ])
  })

  test("the raw reminders carry only the opaque id, name, class, step and days", async () => {
    const agent = await agentWithLogin()
    const id = await studentLead({ name: "Raw Reminder", code: agent.code, createdAt: at(20) })
    const { data, error } = await (await signedIn(agent)).rpc("agent_students", { search: null, page_limit: 20, page_offset: 0, step: null })
    expect(error).toBeNull()
    const answer = data as { reminders: Record<string, unknown>[] }
    expect(answer.reminders).toEqual([{ id, student_name: "Raw Reminder", class_name: "STD 3", step: "Applied", days: 20 }])
    expect(JSON.stringify(data)).not.toMatch(/Mzazi|\+2556/)
  })

  test("a step lists only its students, with the search; the counts stay whole", async () => {
    const agent = await agentWithLogin()
    await studentLead({ name: "Step Applied Two", code: agent.code })
    await studentLead({ name: "Step Visited One", code: agent.code, status: "Visited" })
    await studentLead({ name: "Step Visited Two", code: agent.code, status: "Visited" })
    const client = await signedIn(agent)

    const visited = await getAgentStudents(client, { search: "", limit: 20, offset: 0, step: "Visited" })
    expect(visited).toMatchObject({ ok: true, data: { total: 3, matched: 2, steps: { Applied: 1, Visited: 2 } } })
    // "two" matches an Applied student too; the step keeps it out.
    if (!visited.ok || visited.data.kind !== "active") throw new Error("not active")
    expect(visited.data.students.map((st) => st.name).sort()).toEqual(["Step Visited One", "Step Visited Two"])

    const searched = await getAgentStudents(client, { search: "two", limit: 20, offset: 0, step: "Visited" })
    expect(searched).toMatchObject({ ok: true, data: { matched: 1, students: [{ name: "Step Visited Two" }] } })
    expect(await getAgentStudents(client, { search: "two", limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { matched: 2 } })

    const wrong = await client.rpc("agent_students", { search: null, page_limit: 20, page_offset: 0, step: "visited" })
    expect(wrong.error?.message).toBe("invalid")
  })

  test("the discount is what the agent's code takes off now: their own amount, or the standard", async () => {
    const agent = await agentWithLogin()
    const client = await signedIn(agent)
    expect(await getAgentStudents(client, { search: "", limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { discount: 10000 } })
    expect((await setAgentDiscount(await signedIn(MANAGER), agent.id, 15000, "Dashboard test")).ok).toBe(true)
    expect(await getAgentStudents(client, { search: "", limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { discount: 15000 } })
  })

  test("a refused state still carries nothing but the state", async () => {
    const agent = await agentWithLogin()
    await studentLead({ name: "Refused Reminder", code: agent.code, createdAt: at(30) })
    const client = await signedIn(agent)
    expect((await changeAgentStatus(await signedIn(MANAGER), agent.id, "switch-off", "Dashboard test")).ok).toBe(true)
    const off = await client.rpc("agent_students", { search: null, page_limit: 20, page_offset: 0, step: null })
    expect(off).toMatchObject({ error: null, data: { state: "switched_off" } })
    expect(Object.keys(off.data as object)).toEqual(["state"])
  })

  test("single-student lookup returns own student with reminder, and identical null for another agent's, missing, or malformed id", async () => {
    const agent = await agentWithLogin()
    const other = await agentWithLogin()
    const ownId = await studentLead({ name: "Single Own", code: agent.code, createdAt: at(20) })
    const otherId = await studentLead({ name: "Single Other", code: other.code, createdAt: at(20) })
    const client = await signedIn(agent)

    const own = await getAgentStudent(client, ownId)
    expect(own).toEqual({
      ok: true,
      data: {
        kind: "active",
        student: {
          id: ownId,
          name: "Single Own",
          className: "STD 3",
          status: "Applied",
          notActive: false,
          lastChange: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          declinedReason: null,
          interviewRegistered: false,
          result: null,
          reminder: { step: "Applied", days: 20 },
        },
      },
    })
    expect(JSON.stringify(own)).not.toMatch(/Staff-only explanation|Mzazi|\+2556|50000/)

    // Another agent's student, a missing UUID, and a non-UUID all answer identically.
    const missing = await getAgentStudent(client, "00000000-0000-4000-8000-000000000999")
    const foreign = await getAgentStudent(client, otherId)
    const malformed = await getAgentStudent(client, "not-a-uuid")
    expect(foreign).toEqual({ ok: true, data: { kind: "active", student: null } })
    expect(missing).toEqual(foreign)
    expect(malformed).toEqual(foreign)

    // Staff and visitors get nothing.
    expect(await getAgentStudent(await signedIn(MANAGER), ownId)).toEqual({ ok: false, error: "not-agent" })
    const visitor = await anonClient().rpc("agent_student", { lead_id: ownId })
    expect(visitor.error?.code).toBe("42501")
  })
})
