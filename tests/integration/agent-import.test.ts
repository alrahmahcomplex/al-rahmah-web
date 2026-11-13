import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { confirmationOf, withChanges, type AgentImportRow } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import {
  checkAgentImportFile,
  confirmAgentImport,
  getAgentImport,
  listAgentImports,
  type AgentImportCheck,
} from "@/lib/services/agent-import"
import { changeAgentStatus, createAgent, listAgents } from "@/lib/services/marketing-agents"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Importing agents from a CSV (#190), through the Manager's services against
// local Supabase. Every agent is the test's own, with invented names,
// numbers, codes and emails; counts are scoped to each test's own rows.

const MAILPIT = "http://127.0.0.1:55424"
const HEADER = ["Code", "Full name", "Mobile", "WhatsApp", "Email"]

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}
const asE164 = (local: string) => `+255${local.slice(1)}`

// A code no record holds: three letters and five digits.
function freshCode() {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  return `I${letter()}${letter()}-${randomInt(10_000, 100_000)}`
}

const tag = () => randomUUID().slice(0, 8)
const name = (stem: string) => `${stem} ${tag()}`
const email = () => `import-${tag()}@example.test`
const fileName = () => `agents-${tag()}.csv`

function csv(rows: string[][]): Uint8Array {
  return new TextEncoder().encode(toCsv([HEADER, ...rows]))
}

type Fixture = { id: string; fullName: string; code: string; phone: string; local: string; email: string | null }

async function existingAgent(options: { email?: string } = {}): Promise<Fixture> {
  const fullName = name("Zawadi Stored")
  const local = phone()
  const code = freshCode()
  const created = await createAgent(await signedIn(MANAGER), { fullName, phone: local, code, email: options.email ?? null })
  if (!created.ok || created.data.kind !== "created") throw new Error(`setup failed: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, fullName, code, phone: asE164(local), local, email: options.email ?? null }
}

async function check(rows: string[][], file = fileName()) {
  const checked = await checkAgentImportFile(await signedIn(MANAGER), file, csv(rows))
  if (!checked.ok) throw new Error(`check failed: ${JSON.stringify(checked.error)}`)
  return checked.data
}

const rowAt = (check: AgentImportCheck, sheetRow: number) => check.rows.find((row) => row.sheetRow === sheetRow) as AgentImportRow

async function agentsWithPhones(phones: string[]) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query(
          "select id, full_name, phone, whatsapp, email, code, status::text, approved_by, import_batch_id, user_id from public.marketing_agents where phone = any($1) and retired_at is null order by phone",
          [phones],
        )
      ).rows,
  )
}

async function batchesNamed(file: string) {
  return inRolledBackTransaction(async (sql) => (await sql.query("select * from public.import_batches where file_name = $1", [file])).rows)
}

async function mailTo(address: string): Promise<number> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
  if (!response.ok) throw new Error(`Mailpit answered ${response.status}`)
  const found = (await response.json()) as { messages_count?: number; messages?: unknown[] }
  return found.messages?.length ?? found.messages_count ?? 0
}

describe("Seam 1: the check screen classifies each row against the agents stored", () => {
  test("to create, already present, email to add, email differs, mobile differs and each stored-data refusal", async () => {
    const present = await existingAgent()
    const noEmail = await existingAgent()
    const hasEmail = await existingAgent({ email: email() })
    const otherMobile = await existingAgent()
    const otherName = await existingAgent()
    const retired = await existingAgent()
    const retiredDone = await changeAgentStatus(await signedIn(MANAGER), retired.id, "retire", "Test: wrong record")
    if (!retiredDone.ok) throw new Error("could not retire")
    const mobileHolder = await existingAgent()
    const newMobile = phone()

    const checked = await check([
      [freshCode(), "Neema Import", newMobile, "", ""], // 2 create
      // Case and extra spaces never matter.
      [present.code.toLowerCase(), `  ${present.fullName.toUpperCase().replace(" ", "   ")} `, present.local, "", ""], // 3 present
      [noEmail.code, noEmail.fullName, noEmail.local, "", email()], // 4 email to add
      [hasEmail.code, hasEmail.fullName, hasEmail.local, "", email()], // 5 email differs
      [otherMobile.code, otherMobile.fullName, phone(), "", ""], // 6 mobile differs
      [otherName.code, "Someone Else", phone(), "", ""], // 7 code exists
      [retired.code, retired.fullName, phone(), "", ""], // 8 retired code
      [freshCode(), "Rehema Import", mobileHolder.local, "", ""], // 9 mobile taken
      [freshCode(), "Salma Import", phone(), "", MANAGER.email.toUpperCase()], // 10 email in use by staff
      [freshCode(), "Tumaini Import", "", "", ""], // 11 mobile missing, the file's own check
    ])

    expect(rowAt(checked, 2)).toMatchObject({ class: "create", reason: null, normalized: { mobile: asE164(newMobile) } })
    expect(rowAt(checked, 3)).toMatchObject({ class: "present", agent: { id: present.id } })
    expect(rowAt(checked, 4)).toMatchObject({ class: "email-to-add", agent: { id: noEmail.id, email: null } })
    expect(rowAt(checked, 5)).toMatchObject({ class: "email-differs", reason: "Email differs (not changed)", agent: { email: hasEmail.email } })
    expect(rowAt(checked, 6)).toMatchObject({ class: "mobile-differs", reason: "Mobile differs (not changed)", agent: { phone: otherMobile.phone } })
    expect(rowAt(checked, 7)).toMatchObject({ class: "refused", reason: `Code exists as ${otherName.fullName}` })
    expect(rowAt(checked, 8)).toMatchObject({ class: "refused", reason: "Code belongs to a retired record (use Recreate)" })
    expect(rowAt(checked, 9)).toMatchObject({ class: "refused", reason: `Mobile already belongs to ${mobileHolder.fullName}, ${mobileHolder.code}` })
    expect(rowAt(checked, 10)).toMatchObject({ class: "refused", reason: "Email already in use" })
    expect(rowAt(checked, 11)).toMatchObject({ class: "refused", reason: "Mobile missing", verdict: null })

    // The check saves nothing.
    expect(await agentsWithPhones([asE164(newMobile)])).toEqual([])
  })

  test("a file over the limits is refused before anything reaches the database", async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => [`X-${i}`, `Name ${i}`, "0712000000", "", ""])
    expect(await checkAgentImportFile(await signedIn(MANAGER), fileName(), csv(tooMany))).toEqual({
      ok: false,
      error: { kind: "file", error: { kind: "too-many-rows", maxRows: 1000, rows: 1001 } },
    })
  })
})

describe("Seam 1: confirming an import", () => {
  test("creates each new agent Approved by the Manager with the batch, adds each missing email, and records the batch", async () => {
    const noEmail = await existingAgent()
    const present = await existingAgent()
    const first = { code: freshCode(), fullName: name("Upendo Import"), local: phone(), email: email() }
    const second = { code: freshCode(), fullName: name("Vumilia Import"), local: phone(), whatsapp: phone() }
    const addedEmail = email()
    const file = fileName()

    const checked = await check(
      [
        [first.code, first.fullName, first.local, "", first.email.toUpperCase()],
        [second.code, second.fullName, second.local, second.whatsapp, ""],
        [noEmail.code, noEmail.fullName, noEmail.local, "", addedEmail],
        [present.code, present.fullName, present.local, "", ""],
        ["", "No Code", phone(), "", ""],
      ],
      file,
    )
    const done = await confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))
    expect(done).toEqual({ ok: true, data: { kind: "imported", batchId: expect.any(String), created: 2, emailsAdded: 1, skipped: 2 } })
    if (!done.ok || done.data.kind !== "imported") return
    const { batchId } = done.data

    expect(await agentsWithPhones([asE164(first.local), asE164(second.local)])).toEqual(
      [
        {
          full_name: first.fullName,
          phone: asE164(first.local),
          whatsapp: null,
          email: first.email,
          code: first.code,
        },
        {
          full_name: second.fullName,
          phone: asE164(second.local),
          whatsapp: asE164(second.whatsapp),
          email: null,
          code: second.code,
        },
      ]
        .sort((a, b) => a.phone.localeCompare(b.phone))
        .map((row) => ({ ...row, id: expect.any(String), status: "Approved", approved_by: MANAGER.id, import_batch_id: batchId, user_id: null })),
    )
    const [updated] = await agentsWithPhones([noEmail.phone])
    expect(updated).toMatchObject({ email: addedEmail, import_batch_id: null })

    // The batch: kind, file, who, when and the counts.
    expect(await batchesNamed(file)).toEqual([
      {
        id: batchId,
        kind: "agents",
        file_name: file,
        imported_by: MANAGER.id,
        imported_at: expect.any(Date),
        row_count: 5,
        created_count: 2,
        updated_count: 1,
        skipped_count: 2,
      },
    ])

    // Every write is audited as the Manager, the batch included.
    const audit = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            `select table_name, action, actor_kind::text, actor_staff_id from public.audit_log
             where (table_name = 'import_batches' and row_id = $1)
                or (table_name = 'marketing_agents' and row_id in (select id from public.marketing_agents where import_batch_id = $1 or id = $2))
             order by table_name, action`,
            [batchId, noEmail.id],
          )
        ).rows,
    )
    expect(audit.filter((row) => row.table_name === "import_batches")).toEqual([
      { table_name: "import_batches", action: "insert", actor_kind: "staff", actor_staff_id: MANAGER.id },
    ])
    expect(audit.filter((row) => row.table_name === "marketing_agents" && row.action === "update")).toEqual([
      { table_name: "marketing_agents", action: "update", actor_kind: "staff", actor_staff_id: MANAGER.id },
    ])
    expect(audit.filter((row) => row.table_name === "marketing_agents" && row.action === "insert")).toHaveLength(3)
    expect(audit.every((row) => row.actor_kind === "staff" && row.actor_staff_id === MANAGER.id)).toBe(true)

    // The Agents list filters by the import; the import is listed.
    const listed = await listAgents(await signedIn(MANAGER), { status: "all", importBatchId: batchId, page: 1 })
    expect(listed.ok && listed.data.agents.map((agent) => agent.code).sort()).toEqual([first.code, second.code].sort())
    const imports = await listAgentImports(await signedIn(ADMISSIONS))
    expect(imports.ok && imports.data.find((batch) => batch.id === batchId)).toEqual({
      id: batchId,
      fileName: file,
      importedAt: expect.any(String),
      importedBy: MANAGER.name,
      rowCount: 5,
      createdCount: 2,
      updatedCount: 1,
      skippedCount: 2,
    })
    expect(await getAgentImport(await signedIn(MANAGER), batchId)).toMatchObject({ ok: true, data: { id: batchId } })
  })

  test("sends no email: nothing reaches the mail server and no login is made for an imported email", async () => {
    const noEmail = await existingAgent()
    const created = { code: freshCode(), local: phone(), email: email() }
    const added = email()
    const checked = await check([
      [created.code, name("Wema Import"), created.local, "", created.email],
      [noEmail.code, noEmail.fullName, noEmail.local, "", added],
    ])
    const done = await confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))
    expect(done).toMatchObject({ ok: true, data: { kind: "imported", created: 1, emailsAdded: 1 } })

    // Give an email anything sent a moment to arrive.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(await mailTo(created.email)).toBe(0)
    expect(await mailTo(added)).toBe(0)
    const logins = await inRolledBackTransaction(
      async (sql) => (await sql.query("select id from auth.users where lower(email) = any($1)", [[created.email, added]])).rows,
    )
    expect(logins).toEqual([])
  })

  test("a row that changes between the check and confirm sends the Manager back with that row marked, and nothing is saved", async () => {
    const steady = { code: freshCode(), local: phone() }
    const moving = { code: freshCode(), local: phone() }
    const noEmail = await existingAgent()
    const file = fileName()
    const checked = await check(
      [
        [steady.code, name("Baraka Steady"), steady.local, "", ""],
        [moving.code, name("Imani Moving"), moving.local, "", ""],
        [noEmail.code, noEmail.fullName, noEmail.local, "", email()],
      ],
      file,
    )
    expect(checked.rows.map((row) => row.class)).toEqual(["create", "create", "email-to-add"])

    // Someone else adds an agent with the second row's mobile, and an email
    // for the third row's agent, after the check.
    const taker = await createAgent(await signedIn(MANAGER), { fullName: name("Taker"), phone: moving.local })
    if (!taker.ok || taker.data.kind !== "created") throw new Error("setup failed")
    const emailed = email()
    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await sql.connect()
    try {
      await sql.query("begin")
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.marketing_agents set email = $1 where id = $2", [emailed, noEmail.id])
      await sql.query("commit")
    } finally {
      await sql.end()
    }

    const answer = await confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))
    expect(answer.ok && answer.data.kind).toBe("changed")
    if (!answer.ok || answer.data.kind !== "changed") return
    const rows = withChanges(checked.rows, answer.data.changed)
    expect(rows.map((row) => [row.sheetRow, row.class, row.changed, row.reason])).toEqual([
      [2, "create", false, null],
      [3, "refused", true, `Mobile already belongs to ${taker.data.agent.fullName}, ${taker.data.agent.code}`],
      [4, "email-differs", true, "Email differs (not changed)"],
    ])
    // Nothing was saved: not the unchanged row, not a batch.
    expect(await agentsWithPhones([asE164(steady.local)])).toEqual([])
    expect(await batchesNamed(file)).toEqual([])

    // Confirming the rows as they now stand imports the one left to create.
    const again = await confirmAgentImport(await signedIn(MANAGER), confirmationOf({ fileName: file, rows }))
    expect(again).toMatchObject({ ok: true, data: { kind: "imported", created: 1, emailsAdded: 0, skipped: 2 } })
    expect(await agentsWithPhones([asE164(steady.local)])).toHaveLength(1)
  })

  test("all or nothing: a failure after some agents are created leaves none of them, and no batch", async () => {
    const noEmail = await existingAgent()
    const fresh = [phone(), phone(), phone()]
    const file = fileName()
    const checked = await check(
      [...fresh.map((local, i) => [freshCode(), name(`Pendo ${i}`), local, "", ""]), [noEmail.code, noEmail.fullName, noEmail.local, "", email()]],
      file,
    )

    // Hold the agent whose email the import adds, so confirm creates the
    // three new agents and then waits; give the agent an email meanwhile.
    const holder = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await holder.connect()
    try {
      await holder.query("begin")
      await holder.query("select public.set_audit_actor('system')")
      await holder.query("select 1 from public.marketing_agents where id = $1 for update", [noEmail.id])
      const confirming = confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))
      await waitForLockWait(holder)
      await holder.query("update public.marketing_agents set email = $1 where id = $2", [email(), noEmail.id])
      await holder.query("commit")
      expect(await confirming).toEqual({ ok: false, error: { kind: "conflict" } })
    } finally {
      await holder.query("rollback").catch(() => {})
      await holder.end()
    }
    expect(await agentsWithPhones(fresh.map(asE164))).toEqual([])
    expect(await batchesNamed(file)).toEqual([])
  })

  test("the database re-checks what it is sent: unnormalised values and repeated values are refused", async () => {
    const local = phone()
    const checked = await check([[freshCode(), name("Rashidi Import"), local, "", ""]])
    const [row] = checked.rows
    const tampered = (change: Partial<AgentImportRow["normalized"]>, extra: AgentImportRow[] = []) =>
      confirmationOf({ fileName: checked.fileName, rows: [{ ...row, normalized: { ...row.normalized, ...change } }, ...extra] })
    const manager = await signedIn(MANAGER)
    expect(await confirmAgentImport(manager, tampered({ mobile: local }))).toEqual({ ok: false, error: { kind: "invalid" } })
    expect(await confirmAgentImport(manager, tampered({ code: row.normalized.code!.toLowerCase() }))).toEqual({ ok: false, error: { kind: "invalid" } })
    expect(await confirmAgentImport(manager, tampered({ fullName: ` ${row.normalized.fullName}` }))).toEqual({ ok: false, error: { kind: "invalid" } })
    const twin = { ...row, sheetRow: 3, normalized: { ...row.normalized, mobile: asE164(phone()) } }
    expect(await confirmAgentImport(manager, tampered({}, [twin]))).toEqual({ ok: false, error: { kind: "invalid" } })
    expect(await agentsWithPhones([asE164(local)])).toEqual([])
  })

  test("checking the same file again after a saved confirm finds every row already present, and confirming creates nothing", async () => {
    const noEmail = await existingAgent()
    const fresh = { code: freshCode(), fullName: name("Tumaini Import"), local: phone(), email: email() }
    const addedEmail = email()
    const file = fileName()
    const rows = [
      [fresh.code, fresh.fullName, fresh.local, "", fresh.email],
      [noEmail.code, noEmail.fullName, noEmail.local, "", addedEmail],
    ]
    const manager = await signedIn(MANAGER)

    // The confirm saves; the Manager never hears back, then checks the file again.
    const saved = await confirmAgentImport(manager, confirmationOf(await check(rows, file)))
    expect(saved).toMatchObject({ ok: true, data: { kind: "imported", created: 1, emailsAdded: 1 } })

    const again = await check(rows, file)
    expect(again.rows.map((row) => row.class)).toEqual(["present", "present"])
    expect(await confirmAgentImport(manager, confirmationOf(again))).toEqual({ ok: false, error: { kind: "nothing-to-import" } })
    expect(await agentsWithPhones([asE164(fresh.local)])).toHaveLength(1)
    expect(await batchesNamed(file)).toHaveLength(1)
  })

  test("a confirm with nothing to create or add is refused", async () => {
    const present = await existingAgent()
    const checked = await check([[present.code, present.fullName, present.local, "", ""]])
    expect(await confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))).toEqual({ ok: false, error: { kind: "nothing-to-import" } })
  })
})

describe("Seam 1: who may import", () => {
  test("Admissions Staff, the Accountant and a signed-out visitor are refused the check and confirm, and nothing is created", async () => {
    const local = phone()
    const rows = [[freshCode(), name("Refused Import"), local, "", ""]]
    const checked = await check(rows)
    for (const client of [await signedIn(ADMISSIONS), await signedIn(ACCOUNTANT), anonClient()]) {
      expect(await checkAgentImportFile(client, fileName(), csv(rows))).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await confirmAgentImport(client, confirmationOf(checked))).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await agentsWithPhones([asE164(local)])).toEqual([])
  })

  test("no one writes import batches directly, and a signed-out visitor reads none", async () => {
    const manager = await signedIn(MANAGER)
    const { error } = await manager
      .from("import_batches")
      .insert({ kind: "agents", file_name: "x.csv", imported_by: MANAGER.id, row_count: 1, created_count: 1, updated_count: 0, skipped_count: 0 })
    expect(error).not.toBeNull()
    const read = await anonClient().from("import_batches").select("id")
    expect(read.data ?? []).toEqual([])
  })

  test("a batch never changes, and an agent's import never changes", async () => {
    const steady = phone()
    const checked = await check([[freshCode(), name("Stays Put"), steady, "", ""]])
    const done = await confirmAgentImport(await signedIn(MANAGER), confirmationOf(checked))
    if (!done.ok || done.data.kind !== "imported") throw new Error("import failed")
    const { batchId } = done.data
    const refusals = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const errors: string[] = []
      for (const statement of [
        ["update public.import_batches set file_name = 'other.csv' where id = $1", [batchId]],
        ["delete from public.import_batches where id = $1", [batchId]],
        ["update public.marketing_agents set import_batch_id = null where import_batch_id = $1", [batchId]],
      ] as const) {
        await sql.query("savepoint s")
        try {
          await sql.query(statement[0], [...statement[1]])
          errors.push("none")
        } catch (error) {
          errors.push((error as Error).message)
        }
        await sql.query("rollback to savepoint s")
      }
      return errors
    })
    expect(refusals).toEqual(["update_refused", "delete_refused", "agent_locked"])
  })
})

describe("an import and a Recreate at once", () => {
  test("an import adding an email to an agent while Recreate moves that agent to the same email: both finish, neither deadlocks", async () => {
    const stored = await existingAgent()
    const shared = email()
    const file = fileName()
    const checked = await check([[stored.code, stored.fullName, stored.local, "", shared]], file)
    expect(checked.rows.map((row) => row.class)).toEqual(["email-to-add"])

    // Hold the importer's own staff row, so confirm takes its phone and
    // email locks and then waits at the batch it records (whose imported_by
    // checks that row), before it updates the agent. The importer is a staff
    // member of the test's own, so no other test waits on the row. Confirm
    // runs under the API's statement timeout, so everything that needs a new
    // connection or a sign-in happens before the hold, and the hold has its
    // own short limit.
    const importer = await createThrowawayStaff(["agents.approve"])
    const manager = await signedIn(importer)
    const holder = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await holder.connect()
    try {
      // sessionOf closes its own connection if it fails.
      const recreating = await sessionOf(MANAGER)
      let confirming: ReturnType<typeof confirmAgentImport> | undefined
      let recreate: Promise<unknown> | undefined
      try {
        const recreatingPid = (recreating as unknown as { processID: number }).processID
        await holder.query("begin")
        await holder.query("select 1 from public.staff_members where id = $1 for update", [importer.id])
        const holdUntil = performance.now() + HOLD_LIMIT_MS
        const confirmRequest = confirmAgentImport(manager, confirmationOf(checked))
        confirming = confirmRequest
        const confirmPid = await confirmWaitingWithEmailLock(holder, shared, holdUntil)

        // Recreate moves the agent to a new mobile with the email the import
        // is adding, and waits for the import's email lock.
        const recreateQuery = recreating
          .query("select public.recreate_marketing_agent($1, $2, $3, null, $4, 'New number') as r", [stored.id, stored.fullName, phone(), shared])
          .then(
            (result) => ({ ok: true as const, result }),
            (error: unknown) => ({ ok: false as const, error }),
          )
        recreate = recreateQuery
        await waitingOnEmailLockOf(holder, recreatingPid, confirmPid, shared, holdUntil)
        await holder.query("commit")

        // A deadlock would end one of them with 40P01; a lost wake-up would end
        // confirm with the statement timeout.
        const confirmed = await confirmRequest
        if (!confirmed.ok) throw new Error(`confirm failed: ${JSON.stringify(confirmed.error)}`)
        expect(confirmed).toMatchObject({ ok: true, data: { kind: "imported", emailsAdded: 1 } })
        const recreated = await recreateQuery
        if (!recreated.ok) throw recreated.error
        await recreating.query("commit")
      } finally {
        // On every path: release the row first so confirm and Recreate can
        // finish, let Recreate settle and roll its transaction back, then let
        // the confirm request settle, so nothing commits after the test ends.
        await holder.query("rollback").catch(() => {})
        await recreate
        await recreating.query("rollback").catch(() => {})
        await recreating.end().catch(() => {})
        await confirming?.catch(() => {})
      }
    } finally {
      await holder.end().catch(() => {})
    }
    const current = await inRolledBackTransaction(
      async (sql) => (await sql.query("select email from public.marketing_agents where code = $1 and retired_at is null", [stored.code])).rows,
    )
    expect(current).toEqual([{ email: shared }])
  })
})

describe("confirm at 1,000 rows", () => {
  test("runs as one statement within the statement timeout the API gives a signed-in session", async () => {
    const stem = `${String.fromCharCode(65 + randomInt(0, 26))}${String.fromCharCode(65 + randomInt(0, 26))}${randomInt(100, 1000)}`
    const base = randomInt(10_000_000, 90_000_000)
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      sheet_row: i + 2,
      code: `Q${stem}-${i}`,
      full_name: `Timing Agent ${stem} ${i}`,
      phone: `+2557${String(base + i).padStart(8, "0")}`,
      whatsapp: null,
      email: `timing-${stem.toLowerCase()}-${i}@example.test`,
    }))

    const timing = await inRolledBackTransaction(async (sql) => {
      const timeout = (
        await sql.query<{ setting: string }>(
          "select split_part(c, '=', 2) as setting from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticated' and c like 'statement_timeout=%'",
        )
      ).rows[0].setting
      const { rows: staff } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staff[0].user_id, role: "authenticated" })])
      await sql.query("set local role authenticated")
      await sql.query(`set local statement_timeout = '${timeout}'`)

      const checkedRows = (await sql.query("select public.check_agent_import($1::jsonb) as v", [JSON.stringify(rows)])).rows[0].v as {
        sheet_row: number
        verdict: unknown
      }[]
      const expected = rows.map((row, i) => ({ ...row, expected: checkedRows[i].verdict }))
      const started = performance.now()
      const answer = (await sql.query("select public.confirm_agent_import('timing.csv', 1000, $1::jsonb) as v", [JSON.stringify(expected)])).rows[0].v
      const ms = Math.round(performance.now() - started)
      return { answer, ms, timeout }
    })

    // Printed for the PR's timing report; vitest hides console output here.
    process.stdout.write(`confirm_agent_import, 1,000 rows with emails: ${timing.ms} ms (statement timeout ${timing.timeout})\n`)
    expect(timing.answer).toMatchObject({ outcome: "imported", created: 1000, emails_added: 0, skipped: 0 })
    expect(timing.timeout).toMatch(/^\d+s$/)
    expect(timing.ms).toBeLessThan(parseInt(timing.timeout, 10) * 1000)
  }, 60_000)
})

// Waits until a session is blocked on a lock `holder` holds.
async function waitForLockWait(holder: Client) {
  const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid")
  for (let i = 0; i < 100; i++) {
    const waiting = await holder.query("select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [rows[0].pid])
    if (waiting.rowCount) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("confirm never waited for the held agent")
}

// A direct connection acting as `person`'s signed-in session, as the API
// would, for holding a transaction open while another one runs.
async function sessionOf(person: { id: string }) {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    // A deadlock or a lost wake-up fails the test instead of hanging it.
    await sql.query("set statement_timeout = '15s'")
    await sql.query("begin")
    const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [person.id])
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
    return sql
  } catch (error) {
    // Ending the connection rolls back the transaction it opened.
    await sql.end().catch(() => {})
    throw error
  }
}

// How long a test may hold a lock that confirm waits on: well under the 8s
// statement timeout the API gives a signed-in session, so a slow runner fails
// here, by name, and not as a confirm timeout.
const HOLD_LIMIT_MS = 3000

// lock_login_email's advisory key for `address`, split as pg_locks shows a
// bigint key: the high 32 bits in classid, the low in objid.
const EMAIL_LOCK = `
  with k as (select hashtextextended('login-email:' || lower(btrim($1::text)), 0) as k)
  select 1 from k where l.locktype = 'advisory'
    and l.classid::bigint = (k.k >> 32) & 4294967295
    and l.objid::bigint = k.k & 4294967295`

// Polls `query` on `watcher`, the connection holding the lock, until it
// returns a row or `until` passes. Each poll runs under a statement timeout of
// the time left, so a stalled poll cannot hold the lock past `until`, and a
// row that arrives late still fails.
async function pollFor<T extends object>(watcher: Client, query: string, values: unknown[], until: number, what: string): Promise<T> {
  const late = () => new Error(`${what} within ${HOLD_LIMIT_MS} ms`)
  for (;;) {
    const left = Math.floor(until - performance.now())
    if (left <= 0) throw late()
    await watcher.query(`set local statement_timeout = ${left}`)
    let rows: T[]
    try {
      rows = (await watcher.query<T>(query, values)).rows
    } catch (error) {
      if ((error as { code?: string }).code === "57014") throw late()
      throw error
    }
    if (performance.now() > until) throw late()
    if (rows.length) {
      await watcher.query("set local statement_timeout to default")
      return rows[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// Waits until confirm holds `address`'s email lock and waits on the staff
// row the watcher holds. Returns confirm's backend pid.
async function confirmWaitingWithEmailLock(watcher: Client, address: string, until: number) {
  const row = await pollFor<{ pid: number }>(
    watcher,
    `select w.pid from pg_locks w
     where not w.granted and pg_backend_pid() = any(pg_blocking_pids(w.pid))
       and exists (select 1 from pg_locks l where l.pid = w.pid and l.granted and exists (${EMAIL_LOCK}))`,
    [address],
    until,
    "confirm did not take the email lock and wait on the importer's row",
  )
  return row.pid
}

// Waits until backend `pid` waits on `address`'s email lock, held by `holderPid`.
async function waitingOnEmailLockOf(watcher: Client, pid: number, holderPid: number, address: string, until: number) {
  await pollFor(
    watcher,
    `select 1 from pg_locks l
     where l.pid = $2 and not l.granted and $3 = any(pg_blocking_pids($2)) and exists (${EMAIL_LOCK})`,
    [address, pid, holderPid],
    until,
    "Recreate did not wait on confirm's email lock",
  )
}
