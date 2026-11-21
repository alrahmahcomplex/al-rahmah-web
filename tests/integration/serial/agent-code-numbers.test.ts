import { randomInt, randomUUID } from "node:crypto"
import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { actAsStaff, inRolledBackTransaction, secretClient } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// Discount codes in the v38 format (#404), held to ABC-123 (#462): three
// letters from the name, a hyphen, and the next number after the highest any
// agent code holds (#521): ABC-123, then XYZ-124, from 001 to 999 and round
// again. The numbers come from the sequence agent_code_numbers, which every
// saved code moves past its own number, so creations at the same moment get
// different numbers without waiting for each other.
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

// Runs `work` with the sequence's last number set to `n`, then puts the
// sequence back where it was.
async function withCounter<T>(n: number, work: () => Promise<T>): Promise<T> {
  const keeper = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await keeper.connect()
  const was = await position(keeper)
  try {
    await setCounter(keeper, n)
    return await work()
  } finally {
    await keeper.query("select setval('public.agent_code_numbers', $1, $2)", [was.last_value, was.is_called])
    await keeper.end()
  }
}

// The same, inside a rolled-back transaction.
const atNumber = <T>(n: number, work: (sql: Client) => Promise<T>): Promise<T> => withCounter(n, () => inRolledBackTransaction(work))

// Runs one statement past every trigger, so a code it saves doesn't move the
// sequence: as if stored before #521, or after the sequence went past 999.
async function pastTriggers(sql: Client, query: string, params: unknown[] = []) {
  await sql.query("set local session_replication_role = replica")
  try {
    return await sql.query<{ id: string }>(query, params)
  } finally {
    await sql.query("set local session_replication_role = origin")
  }
}

// Removes every agent record in `sql`'s rolled-back transaction, so the
// numbers held are only the test's own. Past 999 a new code takes the lowest
// number no agent holds, which would otherwise depend on every other test.
const onlyTestAgents = (sql: Client) => pastTriggers(sql, "delete from public.marketing_agents")

// Plants agent records with these codes, past every trigger.
async function plant(sql: Client, codes: string) {
  await pastTriggers(
    sql,
    `insert into public.marketing_agents (full_name, phone, code)
     select 'Planted Agent', '+2556' || lpad((row_number() over () + $2::int)::text, 8, '0'), c
     from unnest($1::text[]) c`,
    [codes.split(" "), randomInt(0, 90_000_000)],
  )
}

// The Manager's import, confirmed as the check screen saw it: each row's
// expected verdict is its verdict now.
async function confirmImport(sql: Client, rows: { code: string; full_name: string }[]) {
  const sent = rows.map((row, i) => ({ sheet_row: i + 2, phone: null, whatsapp: null, email: null, ...row }))
  const { rows: checked } = await sql.query<{ rows: unknown }>(
    `select jsonb_agg(e.value || jsonb_build_object('expected', v.verdict)) as rows
     from jsonb_array_elements($1::jsonb) e
     join public.agent_import_verdicts($1::jsonb) v on v.sheet_row = (e.value ->> 'sheet_row')::integer`,
    [JSON.stringify(sent)],
  )
  await actAsStaff(sql, MANAGER.id)
  const { rows: answer } = await sql.query<{ answer: { outcome: string; created: number } }>(
    "select public.confirm_agent_import('agents-521.csv', $2, $1::jsonb) as answer",
    [JSON.stringify(checked[0].rows), sent.length],
  )
  await sql.query("reset role")
  return answer[0].answer
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

  test("the number always has three digits: after 999 a code takes the lowest number no agent holds", async () => {
    await atNumber(6, async (sql) => {
      await onlyTestAgents(sql)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-007")
      await setCounter(sql, 998)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-999")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-001")
      expect(await create(sql, "BAKARI ALI JUMA")).toBe("BAJ-002")
    })
  })

  test("the staff Create agent path gets the same format, and a name short of three initials is filled from its next letters, then X", async () => {
    await atNumber(700, async (sql) => {
      await onlyTestAgents(sql)
      expect(await create(sql, "Juma Doe")).toBe("JDU-701")
      expect(await create(sql, "Madonna")).toBe("MAD-702")
      expect(await create(sql, "Ox")).toBe("OXX-703")
      expect(await create(sql, "Émile Ali Juma")).toBe("AJM-704")
    })
  })

  // Every number held: today's rule, the next number round again, skipping
  // only a code itself. QQQ-500 holds the one number ZXQ hasn't used.
  const everyNumberHeld = async (sql: Client, free: number | null) => {
    await onlyTestAgents(sql)
    const zxq = Array.from({ length: 999 }, (_, i) => i + 1).filter((k) => k !== free)
    await plant(sql, [...zxq.map((k) => `ZXQ-${String(k).padStart(3, "0")}`), ...(free ? [`QQQ-${String(free).padStart(3, "0")}`] : [])].join(" "))
  }

  test("with every number held, the one number left for a set of initials is found, however far round", async () => {
    await atNumber(farNumber(), async (sql) => {
      await everyNumberHeld(sql, 500)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-500")
    })
  })

  test("a free number is still found when other creations take the numbers it would have tried", async () => {
    await atNumber(farNumber(), async (sql) => {
      await everyNumberHeld(sql, 500)
      // Stepping 999 at a time, as if other creations took every number in
      // between, the sequence offers the same taken number 999 times over.
      await sql.query("alter sequence public.agent_code_numbers increment by 999")
      try {
        expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-500")
      } finally {
        await sql.query("alter sequence public.agent_code_numbers increment by 1")
      }
    })
  })

  test("every set of initials has 999 codes; when all are taken, the creation is refused", async () => {
    await atNumber(farNumber(), async (sql) => {
      await everyNumberHeld(sql, null)
      await expect(create(sql, "ZAWADI XENIA QUINN")).rejects.toThrow(/no_free_code/)
    })
  })

  test("with every number held, a code another record holds is skipped and the next number round is taken", async () => {
    await atNumber(farNumber(), async (sql) => {
      await onlyTestAgents(sql)
      // Every number held by other initials, ZXQ-001 and ZXQ-002 by ZXQ.
      await plant(sql, Array.from({ length: 999 }, (_, i) => `${i < 2 ? "ZXQ" : "QQQ"}-${String(i + 1).padStart(3, "0")}`).join(" "))
      await setCounter(sql, 999 * 7)
      // 001 and 002 are ZXQ's own: 003, a number QQQ also holds.
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-003")
    })
  })

  test("past 999 a typed code doesn't move the sequence, and a new code takes the lowest number no agent holds", async () => {
    const n = farNumber()
    await atNumber(n, async (sql) => {
      await onlyTestAgents(sql)
      expect(await create(sql, "ZAWADI XENIA QUINN", "ZXQ-001")).toBe("ZXQ-001")
      expect(await create(sql, "BAKARI ALI JUMA", "BAJ-003")).toBe("BAJ-003")
      expect(await counter(sql)).toBe(n)

      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-002")
      expect(await create(sql, "BAKARI ALI JUMA")).toBe("BAJ-004")
      expect(await create(sql, "AMINA BAKARI CHANDE")).toBe("ABC-005")
    })
  })

  test("with 999 the highest number held, the next sign-ups take the lowest free numbers, never one already held", async () => {
    await atNumber(400, async (sql) => {
      await onlyTestAgents(sql)
      // Held: 001 to 003, 005, and 999, typed by the Manager.
      await plant(sql, "QVW-001 QVW-002 QVW-003 QVW-005")
      expect(await create(sql, "ZAWADI XENIA QUINN", "ZXQ-999")).toBe("ZXQ-999")
      expect(await counter(sql)).toBe(999)
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-004" })
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-006" })
    })
  })

  test("past 999 a retired record's number is never taken again", async () => {
    await atNumber(farNumber(), async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, "QVW-001")
      await sql.query("select public.set_audit_actor('system')")
      const { rows } = await sql.query<{ id: string }>("select id from public.marketing_agents where code = 'QVW-001'")
      await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [rows[0].id])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-002")
    })
  })

  test("past 999 two sign-ups at the same moment get different numbers, and neither waits for the other", async () => {
    const open = async () => {
      const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
      await sql.connect()
      // A wait fails the test instead of passing late.
      await sql.query("set statement_timeout = '5s'")
      await sql.query("begin")
      return sql
    }
    await withCounter(999, async () => {
      const a = await open()
      const b = await open()
      try {
        // Both open at once: the second passes over the number the first holds.
        const first = await signUp(a, `Amina Bakari Wrapped${randomUUID().slice(0, 4)}`)
        const second = await signUp(b, `Xavier Yusuf Wrapped${randomUUID().slice(0, 4)}`)
        expect(first.outcome).toBe("registered")
        expect(second.outcome).toBe("registered")
        expect(first.code.split("-")[1]).not.toBe(second.code.split("-")[1])
      } finally {
        await a.query("rollback").catch(() => {})
        await b.query("rollback").catch(() => {})
        await a.end()
        await b.end()
      }
    })
  })

  test("a long run of taken codes is passed over", async () => {
    await atNumber(100, async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // 150 codes in a row, ZXQ-101 to ZXQ-250, none of which moved the sequence.
      const planted = await pastTriggers(
        sql,
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
    await atNumber(600, async (sql) => {
      await onlyTestAgents(sql)
      const old = await create(sql, "ZAWADI XENIA QUINN")
      expect(old).toBe("ZXQ-601")
      const { rows } = await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [old])
      await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [rows[0].id])
      await setCounter(sql, 600)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-602")
    })
  })

  test("a generated code a lead already carries is skipped, before 999 and after", async () => {
    await atNumber(600, async (sql) => {
      await onlyTestAgents(sql)
      await sql.query("select public.set_audit_actor('system')")
      // Copies of a seeded lead, on free Admission Numbers, carrying the codes
      // the next ZXQ agents would get.
      for (const code of ["ZXQ-601", "ZXQ-001"]) {
        const planted = await sql.query(
          `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, guardian_contact_id, status, visit_date, referral_code,
                                     custodian_relationship, custodian_relationship_description)
           select (select 'ADMSN-' || lpad(g::text, 5, '0') from generate_series(0, 99999) g
                   where not exists (select 1 from public.leads x where x.admission_number = 'ADMSN-' || lpad(g::text, 5, '0'))
                   order by random() limit 1),
                  'Coded Pupil', l.class_name, l.enrollment_year, l.day_or_boarding, l.guardian_contact_id, l.status, l.visit_date, $1,
                  l.custodian_relationship, l.custodian_relationship_description
           from public.leads l limit 1`,
          [code],
        )
        expect(planted.rowCount).toBe(1)
      }
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-602")
      // Past 999 the lowest free number is 001, which a lead carries as ZXQ-001.
      await setCounter(sql, 999)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-002")
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

describe("the next number comes after the highest any agent code holds (#521)", () => {
  test("an import moves the sequence: with QVW-150 imported, the next sign-up gets XYZ-151", async () => {
    await atNumber(140, async (sql) => {
      // The highest row first: the lower code after it leaves the sequence.
      const imported = await confirmImport(sql, [
        { code: "QVW-150", full_name: "QUDRA VUAI WEMA" },
        { code: "ZXQ-120", full_name: "ZAWADI XENIA QUINN" },
      ])
      expect(imported).toMatchObject({ outcome: "imported", created: 2 })
      expect(await counter(sql)).toBe(150)
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-151" })
    })
  })

  test("a code the Manager types moves the sequence past it; a lower one leaves it", async () => {
    await atNumber(400, async (sql) => {
      expect(await create(sql, "ZAWADI XENIA QUINN", "ZXQ-450")).toBe("ZXQ-450")
      expect(await counter(sql)).toBe(450)
      expect(await create(sql, "BAKARI ALI JUMA")).toBe("BAJ-451")
      expect(await create(sql, "QUDRA VUAI WEMA", "QVW-420")).toBe("QVW-420")
      expect(await counter(sql)).toBe(451)
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-452" })
    })
  })

  test("the one-time fix counts retired records, and only codes in the ABC-123 shape", async () => {
    await atNumber(400, async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Only this test's records, as if the system held nothing else.
      await pastTriggers(sql, "delete from public.marketing_agents")
      const insert = (code: string) =>
        pastTriggers(sql, "insert into public.marketing_agents (full_name, phone, code) values ('Highest Number', $1, $2) returning id", [phone(), code])
      await insert("ZXQ-460")
      // Older shapes have no number here.
      await insert("RE-0990")
      await insert("ABCD-999")
      const retired = await insert("QVW-470")
      await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [retired.rows[0].id])
      expect(Number((await sql.query("select public.highest_agent_code_number() as n")).rows[0].n)).toBe(470)

      // What the migration runs, then the next sign-up.
      await sql.query("select public.move_agent_code_numbers_to(public.highest_agent_code_number())")
      expect(await counter(sql)).toBe(470)
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-471" })

      // It never moves the sequence back.
      await sql.query("select public.move_agent_code_numbers_to(10)")
      expect(await counter(sql)).toBe(471)
    })
  })

  test("the sequence is never moved past 999 by a code's number", async () => {
    await atNumber(990, async (sql) => {
      await sql.query("select public.move_agent_code_numbers_to(5000)")
      expect(await counter(sql)).toBe(999)
    })
  })

  test("a sign-up during an import gets its number at once, after the import's codes", async () => {
    const open = async () => {
      const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
      await sql.connect()
      // A wait on the import fails the test instead of passing late.
      await sql.query("set statement_timeout = '5s'")
      await sql.query("begin")
      return sql
    }
    await withCounter(600, async () => {
      const importing = await open()
      const signing = await open()
      try {
        // The import is still open, holding its locks, when the agent signs up.
        expect(await confirmImport(importing, [{ code: "QVW-650", full_name: "QUDRA VUAI WEMA" }])).toMatchObject({ outcome: "imported" })
        expect(await signUp(signing, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-651" })
      } finally {
        await importing.query("rollback").catch(() => {})
        await signing.query("rollback").catch(() => {})
        await importing.end()
        await signing.end()
      }
    })
  })
})

describe("a code's number", () => {

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
      // Nor call what moves it.
      const callable = await sql.query(
        `select f, r.role
         from unnest(array['public.highest_agent_code_number()', 'public.move_agent_code_numbers_to(bigint)', 'public.move_agent_code_numbers()']) as f,
              unnest(array['anon', 'authenticated', 'service_role']) as r(role)
         where has_function_privilege(r.role, f, 'EXECUTE')`,
      )
      expect(callable.rows).toEqual([])
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
