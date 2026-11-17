import { randomInt, randomUUID } from "node:crypto"
import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { inRolledBackTransaction, secretClient } from "../../support/db"

// Discount codes in the v38 format (#404), held to ABC-123 (#462): three
// letters from the name, a hyphen, and the next number after the last
// generated code (ABC-123, then XYZ-124), from 001 to 999 and round again.
// The numbers come from the sequence agent_code_numbers, so creations at the
// same moment get different numbers without waiting for each other.
//
// A sequence's position is not rolled back with a transaction, so a test that
// moves it puts it back afterwards (`atNumber`). That is safe only while no
// other file creates agents, which is why these tests run in the serial
// folder. Each moves it far above any code other tests make, so the numbers it
// expects are free.

function phone() {
  return `+2557${String(randomInt(10_000_000, 100_000_000))}`
}

// A number no code holds yet: far above any other test's.
const farNumber = () => randomInt(500_000, 900_000_000)

// The three digits a code gets from the sequence's number n: 001 to 999 and
// round again.
const digits = (n: number) => String(((n - 1) % 999) + 1).padStart(3, "0")

async function signUp(sql: Client, fullName: string, code: string | null = null) {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
  await sql.query("set local role service_role")
  const { rows } = await sql.query<{ answer: { outcome: string; code: string } }>(
    "select public.sign_up_marketing_agent($1, $2, null, $3, $4, $5) as answer",
    [fullName, phone(), `numbers-${randomUUID().slice(0, 8)}@example.test`, false, code],
  )
  await sql.query("reset role")
  return rows[0].answer
}

// As the Manager's Create agent and the import call it: with or without a typed code.
async function create(sql: Client, fullName: string, code: string | null = null): Promise<string> {
  await sql.query("select public.set_audit_actor('system')")
  const made = await sql.query<{ agent_id: string }>("select agent_id from public.create_agent_record($1, $2, null, null, $3, 'Pending', null)", [
    fullName,
    phone(),
    code,
  ])
  const { rows } = await sql.query<{ code: string }>("select code from public.marketing_agents where id = $1", [made.rows[0].agent_id])
  return rows[0].code
}

type Position = { last_value: string; is_called: boolean }
const position = async (sql: Client) => (await sql.query<Position>("select last_value, is_called from public.agent_code_numbers")).rows[0]

// The last number taken from the sequence.
async function counter(sql: Client) {
  const at = await position(sql)
  return Number(at.last_value) - (at.is_called ? 0 : 1)
}

const setCounter = (sql: Client, n: number) => sql.query("select setval('public.agent_code_numbers', $1, true)", [n])

// Runs `work` in a rolled-back transaction with the sequence's last number
// set to `n`, then puts the sequence back where it was.
async function atNumber<T>(n: number, work: (sql: Client) => Promise<T>): Promise<T> {
  const keeper = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await keeper.connect()
  const was = await position(keeper)
  try {
    return await inRolledBackTransaction(async (sql) => {
      await setCounter(sql, n)
      return work(sql)
    })
  } finally {
    await keeper.query("select setval('public.agent_code_numbers', $1, $2)", [was.last_value, was.is_called])
    await keeper.end()
  }
}

describe("the Discount code format", () => {
  test("a new code is the three initials and the next number after the last code: QVW-123, then XYZ-124", async () => {
    // Rare initials, so no other test's lead carries these codes.
    await atNumber(122, async (sql) => {
      const first = await signUp(sql, "QUDRA VUAI WEMA")
      expect(first).toMatchObject({ outcome: "registered", code: "QVW-123" })
      const second = await signUp(sql, "XAVIER YUSUF ZUBERI")
      expect(second).toMatchObject({ outcome: "registered", code: "XYZ-124" })
      expect(await counter(sql)).toBe(124)
    })
  })

  test("the number always has three digits: after 999 it starts again at 001", async () => {
    // Small numbers may be taken by seeded codes; a rare prefix keeps them free.
    await atNumber(6, async (sql) => {
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-007")
      await setCounter(sql, 998)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-999")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-001")
      expect(await counter(sql)).toBe(1000)
    })
  })

  test("the staff Create agent path gets the same format, and a name short of three initials is filled from its next letters, then X", async () => {
    const n = farNumber()
    await atNumber(n, async (sql) => {
      expect(await create(sql, "Juma Doe")).toBe(`JDU-${digits(n + 1)}`)
      expect(await create(sql, "Madonna")).toBe(`MAD-${digits(n + 2)}`)
      expect(await create(sql, "Ox")).toBe(`OXX-${digits(n + 3)}`)
      expect(await create(sql, "Émile Ali Juma")).toBe(`AJM-${digits(n + 4)}`)
    })
  })

  test("every set of initials has 999 codes; when all are taken, the creation is refused", async () => {
    await atNumber(farNumber(), async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(
        `insert into public.marketing_agents (full_name, phone, code)
         select 'Taken Prefix', '+2556' || lpad((k + $1::int)::text, 8, '0'), 'ZXQ-' || lpad(k::text, 3, '0')
         from generate_series(1, 999) k`,
        [randomInt(0, 90_000_000)],
      )
      await expect(create(sql, "ZAWADI XENIA QUINN")).rejects.toThrow(/no_free_code/)
    })
  })

  test("a typed code takes no number; a generated code another record holds is skipped", async () => {
    const n = farNumber()
    await atNumber(n, async (sql) => {
      // Codes staff typed, or an import carried, with higher numbers.
      expect(await create(sql, "ZAWADI XENIA QUINN", `ZXQ-${digits(n + 1)}`)).toBe(`ZXQ-${digits(n + 1)}`)
      expect(await create(sql, "BAKARI ALI JUMA", `BAJ-${digits(n + 3)}`)).toBe(`BAJ-${digits(n + 3)}`)
      expect(await counter(sql)).toBe(n)

      // The next ZXQ code would be n + 1, which is taken: it moves on to n + 2.
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe(`ZXQ-${digits(n + 2)}`)
      // BAJ at n + 3 is taken too: n + 4. Skipped numbers are not handed out again.
      expect(await create(sql, "BAKARI ALI JUMA")).toBe(`BAJ-${digits(n + 4)}`)
      expect(await counter(sql)).toBe(n + 4)
      // Another prefix carries on from there.
      expect(await create(sql, "AMINA BAKARI CHANDE")).toBe(`ABC-${digits(n + 5)}`)
    })
  })

  test("a long run of taken codes is passed over", async () => {
    await atNumber(100, async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // 150 typed codes in a row, ZXQ-101 to ZXQ-250, none of which moves the sequence.
      const planted = await sql.query(
        `insert into public.marketing_agents (full_name, phone, code)
         select 'Taken Run', '+2556' || lpad((k + $1::int)::text, 8, '0'), 'ZXQ-' || (100 + k)
         from generate_series(1, 150) k`,
        [randomInt(0, 90_000_000)],
      )
      expect(planted.rowCount).toBe(150)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-251")
    })
  })

  test("a generated code whose twin a Promo code holds is skipped, so the form can tell them apart", async () => {
    await atNumber(300, async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("insert into public.promo_codes (code, name, amount) values ('ZXQ301', 'Twin of an agent code', 1000)")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-302")
    })
  })

  test("a retired record's code is never generated again", async () => {
    const n = farNumber()
    await atNumber(n, async (sql) => {
      const old = await create(sql, "ZAWADI XENIA QUINN")
      expect(old).toBe(`ZXQ-${digits(n + 1)}`)
      const { rows } = await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [old])
      await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [rows[0].id])
      await setCounter(sql, n)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe(`ZXQ-${digits(n + 2)}`)
    })
  })

  test("a generated code a lead already carries is skipped", async () => {
    const n = farNumber()
    await atNumber(n, async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // A copy of a seeded lead, on a free Admission Number, carrying the
      // code the next ZXQ agent would get.
      const planted = await sql.query(
        `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, guardian_contact_id, status, visit_date, referral_code)
         select (select 'ADMSN-' || lpad(g::text, 5, '0') from generate_series(0, 99999) g
                 where not exists (select 1 from public.leads x where x.admission_number = 'ADMSN-' || lpad(g::text, 5, '0'))
                 order by random() limit 1),
                'Coded Pupil', l.class_name, l.enrollment_year, l.day_or_boarding, l.guardian_contact_id, l.status, l.visit_date, $1
         from public.leads l limit 1`,
        [`ZXQ-${digits(n + 1)}`],
      )
      expect(planted.rowCount).toBe(1)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe(`ZXQ-${digits(n + 2)}`)
    })
  })

  test("two sign-ups at the same moment get different numbers, and neither waits for the other", async () => {
    const open = async () => {
      const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
      await sql.connect()
      await sql.query("begin")
      return sql
    }
    const a = await open()
    const b = await open()
    try {
      // The first is still open when the second signs up: the second gets
      // its number at once, a different one.
      const first = await signUp(a, `Amina Bakari Concurrent${randomUUID().slice(0, 4)}`)
      const second = await signUp(b, `Xavier Yusuf Concurrent${randomUUID().slice(0, 4)}`)
      await b.query("commit")
      await a.query("commit")

      const number = (code: string) => Number(code.split("-")[1])
      expect(first.outcome).toBe("registered")
      expect(second.outcome).toBe("registered")
      expect(number(second.code)).toBeGreaterThan(number(first.code))
    } finally {
      await a.query("rollback").catch(() => {})
      await b.query("rollback").catch(() => {})
      await a.end()
      await b.end()
    }
  })

  test("many sign-ups at once all get different codes", async () => {
    const answers = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        secretClient().rpc("sign_up_marketing_agent", {
          full_name: `Parallel Agent Number${i} ${randomUUID().slice(0, 4)}`,
          phone: phone(),
          whatsapp: null,
          email: `parallel-${randomUUID().slice(0, 8)}@example.test`,
          has_code: false,
          code: null,
        }),
      ),
    )
    const codes = answers.map(({ data, error }) => {
      expect(error).toBeNull()
      return (data as { code: string }).code
    })
    const numbers = codes.map((code) => Number(code.split("-")[1]))
    expect(new Set(numbers).size).toBe(6)
    for (const code of codes) expect(code).toMatch(/^PAN-\d{3}$/)
  })
})

describe("the last number", () => {
  test("is the number in the newest record's code shaped like a generated one, retired records included", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Records stored before codes were held to ABC-123 (#462), planted past
      // the triggers that hold new codes to it.
      await sql.query("set local session_replication_role = replica")
      const insert = (code: string, at: string) =>
        sql.query<{ id: string }>(
          "insert into public.marketing_agents (full_name, phone, code, registered_at) values ('Last Number', $1, $2, $3) returning id",
          [phone(), code, at],
        )
      await insert("MAK-042", "2999-01-01")
      // Newer, but not in the generated shape: four letters, or no number.
      await insert("ABCD-999", "2999-01-02")
      await insert("MAMA.SALMA", "2999-01-03")
      expect(Number((await sql.query("select public.last_agent_code_number() as n")).rows[0].n)).toBe(42)

      const retired = await insert("RE-0077", "2999-01-04")
      await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [retired.rows[0].id])
      expect(Number((await sql.query("select public.last_agent_code_number() as n")).rows[0].n)).toBe(77)
    })
  })

  test("reads a code's number only when it has the generated shape", async () => {
    await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select public.agent_code_number('ABC-123') as a, public.agent_code_number('JD-0045') as b, public.agent_code_number('ABC-1000') as c,
                public.agent_code_number('ABCD-12') as d, public.agent_code_number('ABC123') as e, public.agent_code_number('KARIBU2026') as f`,
      )
      expect(rows[0]).toEqual({ a: "123", b: "45", c: "1000", d: null, e: null, f: null })
    })
  })

  test("no client role may read the sequence or take a number from it", async () => {
    await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select r.role, has_sequence_privilege(r.role, 'public.agent_code_numbers', 'USAGE, SELECT, UPDATE') as allowed
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)`,
      )
      expect(rows).toEqual([
        { role: "anon", allowed: false },
        { role: "authenticated", allowed: false },
        { role: "service_role", allowed: false },
      ])
      // Nor PUBLIC, which every role inherits: no grant to it is left.
      const toPublic = await sql.query(
        `select count(*)::int as n
         from pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
         where c.oid = 'public.agent_code_numbers'::regclass and a.grantee = 0`,
      )
      expect(toPublic.rows[0].n).toBe(0)
    })
  })
})
