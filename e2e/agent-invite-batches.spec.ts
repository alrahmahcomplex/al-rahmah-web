import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { asSystem, signedIn } from "../tests/support/db"
import { MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// Invite batches (#192) end to end: the Manager sends a batch from "Approved,
// no account yet" over one import of the test's own, with invented names and
// example.test emails, so the batch never reaches another test's agents. The
// emails land in local Mailpit.

const MAILPIT = "http://127.0.0.1:55424"

async function signInStaff(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

type Imported = { id: string; fullName: string; email: string | null }

// Imports one Approved agent per entry through the Manager's import, as the
// import screen does, and answers the import's id and its agents.
async function importAgents(emails: (string | null)[]): Promise<{ importBatchId: string; agents: Imported[] }> {
  const stem = `Batch ${randomUUID().slice(0, 8)}`
  const rows = emails.map((email, i) => ({
    sheet_row: i + 2,
    code: `EBT-${randomInt(10_000, 100_000)}${i}`,
    full_name: `${stem} Agent ${i + 1}`,
    phone: `+2557${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: null,
    email,
  }))
  const manager = await signedIn(MANAGER)
  const checked = await manager.rpc("check_agent_import", { rows })
  if (checked.error) throw new Error(checked.error.message)
  const verdicts = new Map((checked.data as { sheet_row: number; verdict: unknown }[]).map((row) => [row.sheet_row, row.verdict]))
  const done = await manager.rpc("confirm_agent_import", {
    file_name: `${stem}.csv`,
    row_count: rows.length,
    rows: rows.map((row) => ({ ...row, expected: verdicts.get(row.sheet_row) })),
  })
  const answer = done.data as { outcome: string; batch_id: string } | null
  if (done.error || answer?.outcome !== "imported") throw new Error(`could not import: ${JSON.stringify(done.error ?? answer)}`)
  const ids = await asSystem(async (sql) => {
    const { rows: found } = await sql.query<{ id: string; full_name: string }>(
      "select id, full_name from public.marketing_agents where import_batch_id = $1",
      [answer.batch_id],
    )
    return new Map(found.map((row) => [row.full_name, row.id]))
  })
  return { importBatchId: answer.batch_id, agents: rows.map((row) => ({ id: ids.get(row.full_name)!, fullName: row.full_name, email: row.email })) }
}

// An invite to `email` sent two hours ago, so the batch skips the agent.
async function invitedRecently(agentId: string, email: string) {
  await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      "insert into public.agent_events (agent_id, kind, result, email, created_at) values ($1, 'invite', 'started', $2, now() - interval '2 hours') returning id",
      [agentId, email],
    )
    await sql.query(
      "insert into public.agent_events (agent_id, kind, result, attempt_id, email, created_at) values ($1, 'invite', 'sent', $2, $3, now() - interval '2 hours')",
      [agentId, rows[0].id, email],
    )
  })
}

async function mailCount(email: string) {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  return ((await search.json()) as { messages: unknown[] }).messages.length
}

const report = (page: Page) => page.getByRole("region", { name: "Invite batch" })

test("a batch with mixed results: sent, skipped, no email and failed, each count linking to its agents", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8)
  const emails = [`sent-a-${suffix}@example.test`, `sent-b-${suffix}@example.test`, `refused-${suffix}@exa_mple.test`, null, `recent-${suffix}@example.test`]
  const { importBatchId, agents } = await importAgents(emails)
  // The third address passes the import but Auth refuses it: no underscore
  // is allowed in a domain.
  const [sentA, sentB, refused, noEmail, recent] = agents
  await invitedRecently(recent.id, recent.email!)

  await signInStaff(page, MANAGER)
  await page.goto(`/staff/agents?status=approved&account=no-account&import=${importBatchId}`)
  await expect(page.getByRole("link", { name: /Approved, no account yet/ })).toHaveAttribute("aria-current", "page")

  await page.getByRole("button", { name: "Send invites" }).click()
  const dialog = page.getByRole("dialog", { name: "Send invites to this import's agents" })
  await expect(dialog).toContainText("Anyone invited in the last 24 hours and anyone with no email is skipped.")
  await expect(dialog).toContainText(/Today's budget for agent invites: \d+ of 99980 used/)
  await dialog.getByRole("button", { name: "Send invites" }).click()

  // Each invite goes through local Auth and Mailpit, one at a time.
  await expect(page).toHaveURL(/[?&]batch=[0-9a-f-]{36}/, { timeout: 30_000 })
  await expect(report(page)).toContainText("sent 2, waiting 0, no email 1, failed 1")
  await expect(report(page)).toContainText(/Started \d{1,2} \w{3} \d{4}, \d{2}:\d{2} by Test Manager, finished/)
  await expect(report(page)).toContainText("Every agent waiting for an invite was tried.")
  await expect(report(page)).toContainText("1 skipped as invited in the last 24 hours.")
  await expect.poll(() => mailCount(sentA.email!), { timeout: 15_000 }).toBe(1)
  await expect.poll(() => mailCount(sentB.email!), { timeout: 15_000 }).toBe(1)
  expect(await mailCount(recent.email!)).toBe(0)

  // The counts are read from the database, so a reload shows the same.
  await page.reload()
  await expect(report(page)).toContainText("sent 2, waiting 0, no email 1, failed 1")

  const names = page.getByRole("table", { name: "Marketing Agents" }).getByRole("rowheader")
  await report(page).getByRole("link", { name: "failed 1" }).click()
  await expect(page).toHaveURL(/[?&]outcome=failed/)
  await expect(names).toHaveText([refused.fullName])
  await report(page).getByRole("link", { name: "no email 1" }).click()
  await expect(names).toHaveText([noEmail.fullName])
  await report(page).getByRole("link", { name: "sent 2" }).click()
  await expect(names).toHaveCount(2)
  expect((await names.allTextContents()).sort()).toEqual([sentA.fullName, sentB.fullName].sort())
  await report(page).getByRole("link", { name: "waiting 0" }).click()
  await expect(page.getByText("No agent is waiting for an invite.")).toBeVisible()

  // The filter itself shows the latest batch over this import.
  await page.goto(`/staff/agents?status=approved&account=no-account&import=${importBatchId}`)
  await expect(report(page)).toContainText("sent 2, waiting 0, no email 1, failed 1")
})
