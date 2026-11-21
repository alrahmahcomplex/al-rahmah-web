import { randomInt } from "node:crypto"

import { expect, test } from "vitest"

import { asSystem, secretClient } from "../../support/db"

// The SMS budget under requests at once (#503): reserve_sms takes the day's
// advisory lock before counting, so simultaneous reservations can never take
// more places than the budget has left. The test sets the budget to two places
// above today's spend and fires eight reservations together; exactly two may
// win. The budget row is shared by the whole database, so this file runs in
// the serial folder and puts the budget back afterwards.

test("simultaneous reservations never overspend the day's budget", async () => {
  const mobiles = Array.from({ length: 8 }, () => `+2557${String(randomInt(0, 100_000_000)).padStart(8, "0")}`)
  const before = await asSystem(async (sql) => {
    const { rows } = await sql.query<{ budget: number; spent: number }>(
      `select (select daily_budget from public.sms_settings) as budget,
              (select count(*)::int from public.sms_sends
               where tz_day = (now() at time zone 'Africa/Dar_es_Salaam')::date
                 and result in ('reserved', 'sent', 'provider_error')) as spent`,
    )
    await sql.query("update public.sms_settings set daily_budget = $1", [rows[0].spent + 2])
    return rows[0]
  })

  try {
    const answers = await Promise.all(
      mobiles.map((to_phone) => secretClient().rpc("reserve_sms", { kind: "courtesy", to_phone })),
    )
    expect(answers.map((a) => a.error)).toEqual(mobiles.map(() => null))
    const outcomes = answers.map((a) => (a.data as { outcome: string }).outcome)
    expect(outcomes.filter((o) => o === "reserved")).toHaveLength(2)
    expect(outcomes.filter((o) => o === "budget_reached")).toHaveLength(6)
  } finally {
    await asSystem(async (sql) => {
      await sql.query("update public.sms_settings set daily_budget = $1", [before.budget])
      await sql.query("delete from public.sms_sends where to_phone = any($1)", [mobiles])
    })
  }
})
