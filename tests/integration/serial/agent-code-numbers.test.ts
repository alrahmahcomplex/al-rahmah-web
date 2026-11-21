import { randomInt, randomUUID } from "node:crypto"
import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { actAsStaff, inRolledBackTransaction, secretClient } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// Discount codes in the v38 format (#404), held to ABC-123 (#462): three
// letters from the name, a hyphen, and the number after the highest any agent
// code holds (#521): ABC-123, then XYZ-124. Once 999 is held, the lowest
// number no agent holds; once every number is held, the lowest whose code is
// free. Creations at the same moment get different numbers without waiting
// for each other: each only tries the lock on a number another holds.
//
// Most tests start from no agent records at all (`onlyTestAgents`), in a
// rolled-back transaction, so the numbers they expect don't depend on other
// tests' agents. The tests with two connections commit nothing. They live in
// the serial folder because a creation elsewhere could take the numbers they
// expect.

function phone() {
  return `+2557${String(randomInt(10_000_000, 100_000_000))}`
}

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

const numberOf = (code: string) => code.split("-")[1]

// Runs one statement past every trigger, so a code it saves holds no number
// lock: as if saved before #521, or by another transaction long finished.
async function pastTriggers(sql: Client, query: string, params: unknown[] = []) {
  await sql.query("set local session_replication_role = replica")
  try {
    return await sql.query<{ id: string }>(query, params)
  } finally {
    await sql.query("set local session_replication_role = origin")
  }
}

// Removes every agent record in `sql`'s rolled-back transaction, so the
// numbers held are only the test's own.
const onlyTestAgents = (sql: Client) => pastTriggers(sql, "delete from public.marketing_agents")

// Plants agent records with these codes, past every trigger.
async function plant(sql: Client, codes: string[]) {
  await pastTriggers(
    sql,
    `insert into public.marketing_agents (full_name, phone, code)
     select 'Planted Agent', '+2556' || lpad((row_number() over () + $2::int)::text, 8, '0'), c
     from unnest($1::text[]) c`,
    [codes, randomInt(0, 90_000_000)],
  )
}

const threeDigits = (n: number) => String(n).padStart(3, "0")
const codesFor = (letters: string, numbers: number[]) => numbers.map((n) => `${letters}-${threeDigits(n)}`)
const oneTo999 = Array.from({ length: 999 }, (_, i) => i + 1)

async function retire(sql: Client, code: string) {
  await sql.query("select public.set_audit_actor('system')")
  const { rows } = await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [code])
  await sql.query("select public.record_agent_status_change($1, 'retired', 'Test: retired', null)", [rows[0].id])
}

// Whether `sql`'s transaction holds the lock on number `n`.
async function holdsNumber(sql: Client, n: number) {
  const { rows } = await sql.query<{ held: boolean }>(
    `select exists (
       select 1 from pg_locks l
       where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
         and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('agent-code-number:' || $1::int, 0)
     ) as held`,
    [n],
  )
  return rows[0].held
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

// A connection with its own open transaction, where a wait on a lock fails
// the test instead of passing late.
async function openTransaction() {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  await sql.query("set statement_timeout = '5s'")
  await sql.query("begin")
  return sql
}

async function closeAll(...connections: Client[]) {
  for (const sql of connections) {
    await sql.query("rollback").catch(() => {})
    await sql.end()
  }
}

describe("the Discount code format", () => {
  test("a new code is the three initials and the number after the highest: QVW-123, then XYZ-124", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-122"])
      expect(await signUp(sql, "QUDRA VUAI WEMA")).toMatchObject({ outcome: "registered", code: "QVW-123" })
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-124" })
    })
  })

  test("with no agent at all, the first code ends in 001", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-001")
    })
  })

  test("the staff Create agent path gets the same format, and a name short of three initials is filled from its next letters, then X", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-700"])
      expect(await create(sql, "Juma Doe")).toBe("JDU-701")
      expect(await create(sql, "Madonna")).toBe("MAD-702")
      expect(await create(sql, "Ox")).toBe("OXX-703")
      expect(await create(sql, "Émile Ali Juma")).toBe("AJM-704")
    })
  })

  test("the number always has three digits: once 999 is held a code takes the lowest number no agent holds", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-006"])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-007")
      await plant(sql, ["QQQ-998"])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-999")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-001")
      expect(await create(sql, "BAKARI ALI JUMA")).toBe("BAJ-002")
    })
  })

  test("with 999 the highest number held, the next sign-ups take the lowest free numbers, never one already held", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, codesFor("QVW", [1, 2, 3, 5]))
      // The Manager types the highest number there is.
      expect(await create(sql, "ZAWADI XENIA QUINN", "ZXQ-999")).toBe("ZXQ-999")
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-004" })
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-006" })
    })
  })

  test("once 999 is held, a retired record's number is never taken again", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, codesFor("QVW", [1, 999]))
      await retire(sql, "QVW-001")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-002")
    })
  })

  test("with every number held, numbers repeat: the lowest whose code with these letters is free", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      // ZXQ holds 001 and 002, other letters every other number.
      await plant(sql, [...codesFor("ZXQ", [1, 2]), ...codesFor("QQQ", oneTo999.slice(2))])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-003")
    })
  })

  test("with every number held, the one number left for a set of initials is found", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, [...codesFor("ZXQ", oneTo999.filter((n) => n !== 500)), "QQQ-500"])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-500")
    })
  })

  test("every set of initials has 999 codes; when all are taken, the creation is refused", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, codesFor("ZXQ", oneTo999))
      await expect(create(sql, "ZAWADI XENIA QUINN")).rejects.toThrow(/no_free_code/)
    })
  })

  test("a generated code whose twin a Promo code holds is skipped, and its number is not held", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-300"])
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("insert into public.promo_codes (code, name, amount) values ('ZXQ301', 'Twin of an agent code', 1000)")
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-302")
      // Other creations may still take 301 for other letters.
      expect(await holdsNumber(sql, 301)).toBe(false)
      expect(await holdsNumber(sql, 302)).toBe(true)
    })
  })

  test("a generated code a lead already carries is skipped, below 999 and once it is held", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-600"])
      await sql.query("select public.set_audit_actor('system')")
      // Copies of a seeded lead, on free Admission Numbers, carrying the
      // codes the next ZXQ agents would get.
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
      // Once 999 is held the lowest free number is 001, which a lead carries as ZXQ-001.
      await plant(sql, ["QVW-999"])
      expect(await create(sql, "ZAWADI XENIA QUINN")).toBe("ZXQ-002")
    })
  })

  test("two sign-ups at the same moment get different numbers, and neither waits for the other", async () => {
    const a = await openTransaction()
    const b = await openTransaction()
    try {
      // The first is still open when the second signs up: the second gets
      // its number at once, a different one.
      const first = await signUp(a, `Amina Bakari Concurrent${randomUUID().slice(0, 4)}`)
      const second = await signUp(b, `Xavier Yusuf Concurrent${randomUUID().slice(0, 4)}`)
      expect(first.outcome).toBe("registered")
      expect(second.outcome).toBe("registered")
      expect(numberOf(second.code)).not.toBe(numberOf(first.code))
    } finally {
      await closeAll(a, b)
    }
  })

  test("once 999 is held, two sign-ups at the same moment get different numbers, and neither waits for the other", async () => {
    const a = await openTransaction()
    const b = await openTransaction()
    try {
      // Each sees 999 held, by a record of its own: both look for the lowest
      // free number, and the second passes over the one the first holds.
      await plant(a, ["AAA-999"])
      await plant(b, ["BBB-999"])
      const first = await signUp(a, `Amina Bakari Wrapped${randomUUID().slice(0, 4)}`)
      const second = await signUp(b, `Xavier Yusuf Wrapped${randomUUID().slice(0, 4)}`)
      expect(first.outcome).toBe("registered")
      expect(second.outcome).toBe("registered")
      expect(numberOf(first.code)).not.toBe("999")
      expect(numberOf(second.code)).not.toBe(numberOf(first.code))
    } finally {
      await closeAll(a, b)
    }
  })

  test("with every number held, two sign-ups at the same moment still get different numbers", async () => {
    const a = await openTransaction()
    const b = await openTransaction()
    try {
      // Each sees every number held, by records of its own.
      await plant(a, codesFor("AAA", oneTo999))
      await plant(b, codesFor("BBB", oneTo999))
      const first = await signUp(a, `Amina Bakari Repeat${randomUUID().slice(0, 4)}`)
      const second = await signUp(b, `Xavier Yusuf Repeat${randomUUID().slice(0, 4)}`)
      expect(first.outcome).toBe("registered")
      expect(second.outcome).toBe("registered")
      expect(numberOf(second.code)).not.toBe(numberOf(first.code))
    } finally {
      await closeAll(a, b)
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
    expect(new Set(codes.map(numberOf)).size).toBe(6)
    for (const code of codes) expect(code).toMatch(/^PAN-\d{3}$/)
  })
})

describe("the next number comes after the highest any agent code holds (#521)", () => {
  test("an import counts at once: with QVW-150 imported, the next sign-up gets XYZ-151", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-140"])
      // The highest row first: the lower code after it changes nothing.
      const imported = await confirmImport(sql, [
        { code: "QVW-150", full_name: "QUDRA VUAI WEMA" },
        { code: "ZXQ-120", full_name: "ZAWADI XENIA QUINN" },
      ])
      expect(imported).toMatchObject({ outcome: "imported", created: 2 })
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-151" })
    })
  })

  test("a code the Manager types counts at once; a lower one changes nothing", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["QQQ-400"])
      expect(await create(sql, "ZAWADI XENIA QUINN", "ZXQ-450")).toBe("ZXQ-450")
      expect(await create(sql, "BAKARI ALI JUMA")).toBe("BAJ-451")
      expect(await create(sql, "QUDRA VUAI WEMA", "QVW-420")).toBe("QVW-420")
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-452" })
    })
  })

  test("codes saved before #521 count, retired ones included, and only codes in the ABC-123 shape", async () => {
    await inRolledBackTransaction(async (sql) => {
      await onlyTestAgents(sql)
      await plant(sql, ["ZXQ-460", "RE-0990", "ABCD-999", "QVW-470"])
      await retire(sql, "QVW-470")
      expect(Number((await sql.query("select public.highest_agent_code_number() as n")).rows[0].n)).toBe(470)
      expect(await signUp(sql, "XAVIER YUSUF ZUBERI")).toMatchObject({ outcome: "registered", code: "XYZ-471" })
    })
  })

  test("a sign-up during an import gets a number at once, never the import's", async () => {
    const importing = await openTransaction()
    const signing = await openTransaction()
    try {
      // The import is still open, holding its locks, when the agent signs up.
      expect(await confirmImport(importing, [{ code: "QVW-650", full_name: "QUDRA VUAI WEMA" }])).toMatchObject({ outcome: "imported" })
      expect(await holdsNumber(importing, 650)).toBe(true)
      const signed = await signUp(signing, "XAVIER YUSUF ZUBERI")
      expect(signed.outcome).toBe("registered")
      expect(numberOf(signed.code)).not.toBe("650")
    } finally {
      await closeAll(importing, signing)
    }
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

  test("no client role may call what reads or holds the numbers", async () => {
    await inRolledBackTransaction(async (sql) => {
      const callable = await sql.query(
        `select f, r.role
         from unnest(array['public.highest_agent_code_number()', 'public.hold_agent_code_number()']) as f,
              unnest(array['anon', 'authenticated', 'service_role']) as r(role)
         where has_function_privilege(r.role, f, 'EXECUTE')`,
      )
      expect(callable.rows).toEqual([])
    })
  })
})
