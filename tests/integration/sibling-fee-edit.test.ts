import { randomInt, randomUUID } from "node:crypto";

import { Client } from "pg";
import { describe, expect, onTestFinished, test } from "vitest";

import { PERMISSIONS } from "@/lib/permissions";
import { tanzaniaToday } from "@/lib/school-calendar";
import { getLeadHistory } from "@/lib/services/audit";
import { decideDiscount, requestDiscount } from "@/lib/services/discounts";
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees";
import {
  recordInterviewResult,
  registerForInterview,
} from "@/lib/services/interviews";
import { declineLead } from "@/lib/services/lead-closure";
import { getLeadFee } from "@/lib/services/lead-fees";
import {
  createLead,
  getLead,
  type LeadClass,
  type NewContact,
} from "@/lib/services/leads";
import { recordPayment } from "@/lib/services/school-fee-payments";
import { setPriorSibling } from "@/lib/services/sibling-groups";
import {
  editSiblingFee,
  linkSibling,
  previewSiblingFeeEdit,
  type SiblingFeeEditReason,
  type SiblingFeeEditValue,
} from "@/lib/services/sibling-groups";
import {
  decideSiblingRequest,
  getLeadSiblingRequests,
  requestSiblingDiscount,
} from "@/lib/services/sibling-requests";

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inOneSnapshot,
  inRolledBackTransaction,
  signedIn,
} from "../support/db";
import { claimFeeYear } from "../support/fee-years";
import {
  ACCOUNTANT,
  ADMISSIONS,
  MANAGER,
  SEEDED_AGENT,
  SUPER_ADMIN,
} from "../support/fixtures";

// The manual Sibling fee edit and its preview (#303), through the services
// and the database functions against local Supabase. Each test makes its own
// families in a year it claims. "Amina Juma Hassan" has the father "Juma
// Hassan", so two children with one father link as siblings.

const DAY = 24 * 60 * 60 * 1000;
const today = tanzaniaToday();
const yesterday = tanzaniaToday(new Date(Date.now() - DAY));
const thisYear = Number(today.slice(0, 4));

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
};

const KG1 = 1_100_000;
const STD2 = 2_000_000;
const SIBLING = { kind: "sibling", percent: 10 };
const tenOff = (fee: number) => fee - fee / 10;

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear();
  onTestFinished(claim.release);
  const saved = await saveFeeAmounts(
    await signedIn(ACCOUNTANT),
    claim.year,
    AMOUNTS,
  );
  if (!saved.ok)
    throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`);
  return claim.year;
}

function parent(): NewContact {
  // A leading 04 keeps it clear of the seeded numbers and the other sibling suites.
  return {
    fullName: `Fee Edit Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  };
}

function father(): string {
  const word = () =>
    randomUUID()
      .replace(/[^a-f]/g, "")
      .slice(0, 6)
      .padEnd(6, "a");
  return `F${word()} H${word()}`;
}

async function pass(leadId: string, year: number) {
  const admissions = await signedIn(ADMISSIONS);
  const registered = await registerForInterview(admissions, leadId);
  if (!registered.ok)
    throw new Error(`registration failed: ${registered.error}`);
  const recorded = await recordInterviewResult(
    admissions,
    registered.data.interviewId,
    {
      interviewDate: today,
      result: "Passed",
      score: 80,
    },
  );
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`);
  await asSystem((sql) =>
    sql.query("update public.leads set enrollment_year = $2 where id = $1", [
      leadId,
      year,
    ]),
  );
}

async function child(
  year: number,
  fatherName: string,
  className: LeadClass,
): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: parent() },
    student: {
      fullName: `Kid${randomUUID().slice(0, 6)} ${fatherName}`,
      className,
      enrollmentYear: thisYear + 1,
      dayOrBoarding: "Day",
    },
    start: { kind: "walk-in", visitDate: yesterday },
  });
  if (!created.ok)
    throw new Error(`setup failed: ${JSON.stringify(created.error)}`);
  await pass(created.data.leadId, year);
  return created.data.leadId;
}

// Two children with one father, on two contacts, linked: registered together.
async function together(
  year: number,
): Promise<{ dear: string; cheap: string; group: string }> {
  const name = father();
  const dear = await child(year, name, "STD 2");
  const cheap = await child(year, name, "KG 1");
  const linked = await linkSibling(await signedIn(ADMISSIONS), {
    leadId: cheap,
    siblingOfLeadId: dear,
  });
  if (!linked.ok || linked.data.kind !== "linked")
    throw new Error(`link failed: ${JSON.stringify(linked)}`);
  return { dear, cheap, group: linked.data.groupId };
}

async function payInFull(leadId: string) {
  const fee = await feeOf(leadId);
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: fee.schoolFee, paidOn: today },
    randomUUID(),
  );
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`);
}

async function statusOf(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId);
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`);
  return lead.data.status;
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId);
  if (!fee.ok || fee.data.kind !== "fee")
    throw new Error(`no fee: ${JSON.stringify(fee)}`);
  return fee.data;
}

type Stored = { result: string; source: string; locked_result: string | null };

async function resultOf(leadId: string, sql?: Client): Promise<Stored> {
  const read = async (client: Client) =>
    (
      await client.query<Stored>(
        `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source,
                r.locked_result::text as locked_result
         from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
        [leadId],
      )
    ).rows[0];
  return sql ? read(sql) : inRolledBackTransaction(read);
}

async function fullPayerOf(groupId: string): Promise<string | null> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query(
          "select full_payer_lead_id from public.sibling_groups where id = $1",
          [groupId],
        )
      ).rows[0].full_payer_lead_id,
  );
}

async function editsOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query(
          `select staff_id, value::text, reason::text, note, old_result::text, old_source::text,
                  new_result::text, new_source::text, changes
           from public.sibling_fee_edits where lead_id = $1 order by created_at`,
          [leadId],
        )
      ).rows,
  );
}

async function edit(
  leadId: string,
  value: SiblingFeeEditValue,
  reason: SiblingFeeEditReason = "data_entry_correction",
  note?: string,
) {
  const saved = await editSiblingFee(
    await signedIn(ACCOUNTANT),
    { leadId, value, reason, note },
    randomUUID(),
  );
  if (!saved.ok) throw new Error(`edit failed: ${JSON.stringify(saved.error)}`);
  return saved.data;
}

async function preview(leadId: string, value: SiblingFeeEditValue) {
  const previewed = await previewSiblingFeeEdit(
    await signedIn(ACCOUNTANT),
    leadId,
    value,
  );
  if (!previewed.ok)
    throw new Error(`preview failed: ${JSON.stringify(previewed.error)}`);
  return previewed.data;
}

// The changes without the figures that need no checking here.
function feeMoves(
  changes: {
    leadId: string;
    edited: boolean;
    schoolFeeChange: number | null;
  }[],
) {
  return changes.map((c) => ({
    leadId: c.leadId,
    edited: c.edited,
    schoolFeeChange: c.schoolFeeChange,
  }));
}

// A statement as `staff` signed in, on a direct connection inside `sql`'s
// transaction. A savepoint keeps the transaction usable when it fails.
async function asStaff(
  sql: Client,
  staffId: string,
  query: string,
  params: unknown[] = [],
) {
  const { rows } = await sql.query<{ user_id: string }>(
    "select user_id from public.staff_members where id = $1",
    [staffId],
  );
  await sql.query("savepoint as_staff");
  try {
    await sql.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: rows[0].user_id, role: "authenticated" }),
    ]);
    await sql.query("set local role authenticated");
    const result = (await sql.query(query, params)).rows;
    await sql.query("reset role");
    await sql.query("release savepoint as_staff");
    return result;
  } catch (error) {
    await sql.query("rollback to savepoint as_staff");
    throw error;
  }
}

describe("the owner's case and the spec's acceptance criteria", () => {
  test("a manual 10% on an Enrolled anchor: the preview says its sibling loses the 10%, and the save does exactly that", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap, group } = await together(year);
    await payInFull(dear);
    expect(await statusOf(dear)).toBe("Enrolled");
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });

    const previewed = await preview(dear, "ten");
    expect(previewed.old).toEqual({ result: "full", source: "locked" });
    expect(previewed.new).toEqual({ result: "ten", source: "manual" });
    expect(feeMoves(previewed.changes)).toEqual([
      { leadId: dear, edited: true, schoolFeeChange: -STD2 / 10 },
      { leadId: cheap, edited: false, schoolFeeChange: KG1 / 10 },
    ]);
    expect(previewed.changes[1].before).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: "sibling",
      discountPercent: 10,
    });
    expect(previewed.changes[1].after).toMatchObject({
      schoolFee: KG1,
      discount: null,
      discountPercent: null,
    });

    // The preview saved nothing.
    expect(await resultOf(dear)).toMatchObject({
      result: "full",
      source: "locked",
    });
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });
    expect(await editsOf(dear)).toEqual([]);

    const saved = await edit(
      dear,
      "ten",
      "sibling_proof_after_enrolment",
      "Birth certificates seen.",
    );
    expect({ ...saved, editId: undefined }).toEqual({
      ...previewed,
      editId: undefined,
    });
    expect(await feeOf(dear)).toMatchObject({
      schoolFee: tenOff(STD2),
      discount: SIBLING,
    });
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1,
      discount: null,
    });
    expect(await statusOf(dear)).toBe("Enrolled");
    // The Enrolled lead keeps the result fixed at enrolment underneath.
    expect(await resultOf(dear)).toEqual({
      result: "ten",
      source: "manual",
      locked_result: "full",
    });
    expect(await fullPayerOf(group)).toBe(cheap);
  });

  test("the preview and the save change exactly the same rows, and nothing else in the database", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);
    await payInFull(dear);

    // One repeatable-read snapshot: fees other tests write meanwhile are
    // invisible to it, so the only rows that can move between the two reads
    // of the whole database are the ones this transaction writes. No table
    // is locked, so tests running alongside never wait on this one (#384).
    await inOneSnapshot(async (sql) => {
      const snapshot = async () =>
        new Map(
          (
            await sql.query<{ item: string; value: unknown }>(
              "select item, value from public.fee_snapshot()",
            )
          ).rows.map((r) => [r.item, JSON.stringify(r.value)]),
        );
      const before = await snapshot();
      const [{ preview_sibling_fee_edit: previewed }] = await asStaff(
        sql,
        ACCOUNTANT.id,
        "select public.preview_sibling_fee_edit($1, 'ten')",
        [dear],
      );
      expect(await snapshot()).toEqual(before);

      const [{ edit_sibling_fee: saved }] = await asStaff(
        sql,
        ACCOUNTANT.id,
        "select public.edit_sibling_fee($1, 'ten', 'data_entry_correction', null, $2)",
        [dear, randomUUID()],
      );
      const after = await snapshot();
      const moved = [...after.keys()].filter(
        (item) => after.get(item) !== before.get(item),
      );
      expect(moved.sort()).toEqual([`lead:${cheap}`, `lead:${dear}`].sort());
      expect(saved.changes).toEqual(previewed.changes);
      for (const change of previewed.changes as {
        lead_id: string;
        after: { school_fee: number };
      }[]) {
        expect(
          JSON.parse(after.get(`lead:${change.lead_id}`) as string).school_fee,
        ).toBe(change.after.school_fee);
      }
    });
  });

  test("Back to automatic on an Enrolled lead restores the result fixed at enrolment, not a fresh calculation", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);
    // The cheaper child enrols at 10%; the dearer child never enrols.
    await payInFull(cheap);
    expect(await statusOf(cheap)).toBe("Enrolled");
    expect(await resultOf(cheap)).toEqual({
      result: "ten",
      source: "locked",
      locked_result: "ten",
    });
    expect(
      (
        await declineLead(await signedIn(MANAGER), dear, {
          reason: "Other",
          explanation: "Did not enrol.",
        })
      ).ok,
    ).toBe(true);

    // The owner's case: the Accountant resets it to full.
    const reset = await edit(cheap, "full", "full_fee_sibling_not_enrolled");
    expect(feeMoves(reset.changes)).toEqual([
      { leadId: cheap, edited: true, schoolFeeChange: KG1 / 10 },
    ]);
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1,
      discount: null,
    });
    expect(await resultOf(cheap)).toEqual({
      result: "full",
      source: "manual",
      locked_result: "ten",
    });

    // Today's rule would give it nothing (no counting sibling is left), but
    // Back to automatic restores the 10% fixed at enrolment.
    const undone = await edit(cheap, "automatic");
    expect(undone.new).toEqual({ result: "ten", source: "locked" });
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });
    expect(await statusOf(cheap)).toBe("Enrolled");
  });

  test("Back to automatic keeps the tick's 10% over a Full fee fixed at enrolment, as before the edit", async () => {
    const year = await yearWithSchedule();
    const { dear } = await together(year);
    await payInFull(dear);
    expect(await statusOf(dear)).toBe("Enrolled");
    expect(await resultOf(dear)).toEqual({
      result: "full",
      source: "locked",
      locked_result: "full",
    });

    // The tick gives the 10% over the full lock (#353); a manual Full fee overrides that.
    const admissions = await signedIn(ADMISSIONS);
    expect(
      (
        await setPriorSibling(admissions, dear, {
          name: "Older Sister",
          className: "STD 7",
        })
      ).ok,
    ).toBe(true);
    expect(await resultOf(dear)).toEqual({
      result: "ten",
      source: "prior_sibling",
      locked_result: "full",
    });
    await edit(dear, "full");
    expect(await resultOf(dear)).toEqual({
      result: "full",
      source: "manual",
      locked_result: "full",
    });

    // Back to automatic is the answer the lead had before the edit. Restoring
    // the full lock while the tick stands would flip to 10% on the next refresh.
    const undone = await edit(dear, "automatic");
    expect(undone.new).toEqual({ result: "ten", source: "prior_sibling" });
    expect(await feeOf(dear)).toMatchObject({
      schoolFee: tenOff(STD2),
      discount: SIBLING,
    });

    // Clearing the tick goes back to the Full fee fixed at enrolment.
    expect((await setPriorSibling(admissions, dear, null)).ok).toBe(true);
    expect(await resultOf(dear)).toEqual({
      result: "full",
      source: "locked",
      locked_result: "full",
    });
    expect(await feeOf(dear)).toMatchObject({
      schoolFee: STD2,
      discount: null,
    });
  });

  test("a manual 10% does not beat Staff child 25%", async () => {
    const year = await yearWithSchedule();
    const { cheap } = await together(year);
    const made = await requestDiscount(
      await signedIn(ADMISSIONS),
      cheap,
      "staff_child",
      "For the test.",
      randomUUID(),
    );
    if (!made.ok)
      throw new Error(`request failed: ${JSON.stringify(made.error)}`);
    expect(
      (
        await decideDiscount(await signedIn(MANAGER), made.data, {
          decision: "grant",
        })
      ).ok,
    ).toBe(true);
    expect(await feeOf(cheap)).toMatchObject({
      discount: { kind: "staff_child", percent: 25 },
    });

    await edit(cheap, "full");
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1 - KG1 / 4,
      discount: { kind: "staff_child", percent: 25 },
    });
    const saved = await edit(cheap, "ten");
    expect(saved.changes).toEqual([]);
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1 - KG1 / 4,
      discount: { kind: "staff_child", percent: 25 },
    });
  });

  test("every edit is in the audit and the lead history with who, when, the old and new value and the reason", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);
    await payInFull(dear);

    await edit(
      dear,
      "ten",
      "sibling_proof_after_enrolment",
      "  Birth certificates seen.  ",
    );
    await edit(dear, "automatic", "data_entry_correction");

    const edits = await editsOf(dear);
    expect(edits).toMatchObject([
      {
        staff_id: ACCOUNTANT.id,
        value: "ten",
        reason: "sibling_proof_after_enrolment",
        note: "Birth certificates seen.",
        old_result: "full",
        old_source: "locked",
        new_result: "ten",
        new_source: "manual",
      },
      {
        staff_id: ACCOUNTANT.id,
        value: "automatic",
        reason: "data_entry_correction",
        note: null,
        old_result: "ten",
        old_source: "manual",
        new_result: "full",
        new_source: "locked",
      },
    ]);
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });

    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), dear);
    if (!history.ok) throw new Error(`no history: ${history.error}`);
    const logged = history.data.entries.filter(
      (e) => e.record === "sibling_fee_edits",
    );
    expect(logged).toHaveLength(2);
    for (const entry of logged) {
      expect(entry.actor).toBe(ACCOUNTANT.name);
      expect(entry.action).toBe("insert");
      expect(Date.parse(entry.at)).not.toBeNaN();
    }
    const fields = (entry: (typeof logged)[number]) =>
      Object.fromEntries(entry.changes.map((c) => [c.field, c.to]));
    expect(logged.map(fields)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "ten",
          reason: "sibling_proof_after_enrolment",
          old_result: "full",
          new_result: "ten",
        }),
        expect.objectContaining({
          value: "automatic",
          reason: "data_entry_correction",
          old_result: "ten",
          new_result: "full",
        }),
      ]),
    );
    // The result row's own entries: into manual, then out of it. (The
    // Accountant's payment that enrolled the lead locked it before them.)
    const results = history.data.entries.filter(
      (e) => e.record === "lead_sibling_results" && e.action === "update",
    );
    const sources = results
      .filter((e) => e.actor === ACCOUNTANT.name)
      .map((e) => e.changes.find((c) => c.field === "source"))
      .filter((c) => c && (c.from === "manual" || c.to === "manual"))
      .map((c) => [c?.from, c?.to]);
    expect(sources).toEqual(
      expect.arrayContaining([
        ["locked", "manual"],
        ["manual", "locked"],
      ]),
    );
    expect(sources).toHaveLength(2);
  });
});

describe('"Granted: fee edit needed" (#302)', () => {
  test("a saved 10% closes it as applied with the edit's reason; a preview, a Full fee, Back to automatic or a failed save leave it open", async () => {
    const year = await yearWithSchedule();
    // Enrolled at Full fee, then linked to a child of another father: it waits on a request.
    const enrolled = await child(year, father(), "STD 2");
    await payInFull(enrolled);
    expect(await resultOf(enrolled)).toEqual({
      result: "full",
      source: "locked",
      locked_result: "full",
    });
    const name = father();
    const other = await child(year, name, "FORM 1");
    const linked = await linkSibling(await signedIn(ADMISSIONS), {
      leadId: enrolled,
      siblingOfLeadId: other,
    });
    expect(linked).toMatchObject({
      ok: true,
      data: { kind: "linked", basis: "request_needed" },
    });
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
      leadId: enrolled,
      note: "Birth certificates show the same mother.",
      requestId: randomUUID(),
    });
    if (!asked.ok)
      throw new Error(`request failed: ${JSON.stringify(asked.error)}`);
    expect(
      (
        await decideSiblingRequest(await signedIn(MANAGER), asked.data, {
          decision: "grant",
        })
      ).ok,
    ).toBe(true);

    const feeEditOf = async () => {
      const read = await getLeadSiblingRequests(
        await signedIn(ADMISSIONS),
        enrolled,
      );
      if (!read.ok) throw new Error(`read failed: ${read.error}`);
      return read.data.map((r) => ({
        feeEdit: r.feeEdit,
        reason: r.feeEditReason,
        by: r.feeEditClosedBy,
      }));
    };
    expect(await feeEditOf()).toEqual([
      { feeEdit: "needed", reason: null, by: null },
    ]);

    // None of these closes it.
    await preview(enrolled, "ten");
    const accountant = await signedIn(ACCOUNTANT);
    const used = randomUUID();
    expect(
      (
        await editSiblingFee(
          accountant,
          { leadId: other, value: "full", reason: "data_entry_correction" },
          used,
        )
      ).ok,
    ).toBe(true);
    const failed = [
      await editSiblingFee(
        await signedIn(MANAGER),
        {
          leadId: enrolled,
          value: "ten",
          reason: "sibling_proof_after_enrolment",
        },
        randomUUID(),
      ),
      await editSiblingFee(
        accountant,
        {
          leadId: enrolled,
          value: "ten",
          reason: "sibling_proof_after_enrolment",
        },
        used,
      ),
      await editSiblingFee(
        accountant,
        {
          leadId: enrolled,
          value: "ten",
          reason: "sibling_proof_after_enrolment",
          note: "x".repeat(1001),
        },
        randomUUID(),
      ),
    ];
    expect(failed.map((f) => (f.ok ? "saved" : f.error.kind))).toEqual([
      "forbidden",
      "request-reused",
      "invalid",
    ]);
    await edit(enrolled, "full", "data_entry_correction");
    expect(await feeEditOf()).toEqual([
      { feeEdit: "needed", reason: null, by: null },
    ]);
    // Back to automatic restores the Full fee fixed at enrolment: still needed.
    expect(
      (await edit(enrolled, "automatic", "data_entry_correction")).new,
    ).toEqual({ result: "full", source: "locked" });
    expect(await feeEditOf()).toEqual([
      { feeEdit: "needed", reason: null, by: null },
    ]);

    // The 10% saved: closed as applied, by the Accountant, with the reason; a retry closes nothing more.
    const requestId = randomUUID();
    const input = {
      leadId: enrolled,
      value: "ten",
      reason: "sibling_proof_after_enrolment",
    } as const;
    const saved = await editSiblingFee(accountant, input, requestId);
    expect(saved.ok).toBe(true);
    expect(await feeOf(enrolled)).toMatchObject({
      schoolFee: tenOff(STD2),
      discount: SIBLING,
    });
    expect(await feeEditOf()).toEqual([
      {
        feeEdit: "applied",
        reason: "sibling_proof_after_enrolment",
        by: "Test Accountant",
      },
    ]);
    expect(await editSiblingFee(accountant, input, requestId)).toEqual(saved);
    expect(await feeEditOf()).toEqual([
      {
        feeEdit: "applied",
        reason: "sibling_proof_after_enrolment",
        by: "Test Accountant",
      },
    ]);
  });
});

describe("the full payer and the group", () => {
  test("when the full payer takes a manual 10%, the sibling not yet Enrolled becomes the full payer", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap, group } = await together(year);
    expect(await fullPayerOf(group)).toBe(dear);

    const previewed = await preview(dear, "ten");
    expect(feeMoves(previewed.changes)).toEqual([
      { leadId: dear, edited: true, schoolFeeChange: -STD2 / 10 },
      { leadId: cheap, edited: false, schoolFeeChange: KG1 / 10 },
    ]);
    const saved = await edit(dear, "ten");
    expect(saved.changes).toEqual(previewed.changes);
    expect(await fullPayerOf(group)).toBe(cheap);
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1,
      discount: null,
    });

    // A recompute of the group leaves the manual value alone.
    await asSystem((sql) =>
      sql.query("select public.recompute_sibling_group($1, 'sibling')", [
        group,
      ]),
    );
    expect(await resultOf(dear)).toMatchObject({
      result: "ten",
      source: "manual",
    });

    // Back to automatic: it is a later sibling now, and gets the 10%.
    await edit(dear, "automatic");
    expect(await resultOf(dear)).toMatchObject({
      result: "ten",
      source: "auto",
    });
    expect(await fullPayerOf(group)).toBe(cheap);
  });

  test("a full payer set to Full fee by hand keeps the place, so no second sibling pays full", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap, group } = await together(year);

    const saved = await edit(dear, "full");
    expect(saved.changes).toEqual([]);
    expect(await fullPayerOf(group)).toBe(dear);
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });
  });

  test("a manual value survives enrolment: the result is fixed underneath and the source stays manual", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);

    await edit(cheap, "full", "data_entry_correction");
    expect(await feeOf(cheap)).toMatchObject({
      schoolFee: KG1,
      discount: null,
    });
    await payInFull(cheap);
    expect(await statusOf(cheap)).toBe("Enrolled");
    expect(await resultOf(cheap)).toEqual({
      result: "full",
      source: "manual",
      locked_result: "full",
    });

    // An Enrolled sibling's result never moves when another lead is edited.
    await payInFull(dear);
    await edit(dear, "ten");
    expect(await resultOf(cheap)).toEqual({
      result: "full",
      source: "manual",
      locked_result: "full",
    });
  });

  test("a lead in no group can be edited, and Back to automatic gives it the rule's answer again", async () => {
    const year = await yearWithSchedule();
    const alone = await child(year, father(), "KG 1");
    const saved = await edit(alone, "ten", "data_entry_correction");
    expect(feeMoves(saved.changes)).toEqual([
      { leadId: alone, edited: true, schoolFeeChange: -KG1 / 10 },
    ]);
    expect(await feeOf(alone)).toMatchObject({
      schoolFee: tenOff(KG1),
      discount: SIBLING,
    });
    await edit(alone, "automatic");
    expect(await resultOf(alone)).toMatchObject({
      result: "none",
      source: "auto",
    });
    expect(await feeOf(alone)).toMatchObject({
      schoolFee: KG1,
      discount: null,
    });
  });

  test("a 10% that lowers the fee enough enrols the lead, as after a payment adjustment", async () => {
    const year = await yearWithSchedule();
    const alone = await child(year, father(), "KG 1");
    const paid = await recordPayment(
      await signedIn(ACCOUNTANT),
      alone,
      { type: "full_payment", amount: tenOff(KG1), paidOn: today },
      randomUUID(),
    );
    if (!paid.ok) throw new Error(`payment failed: ${paid.error}`);
    expect(await statusOf(alone)).not.toBe("Enrolled");

    const previewed = await preview(alone, "ten");
    expect(previewed.changes[0].after).toMatchObject({
      status: "Enrolled",
      priority: "Full",
    });
    await edit(alone, "ten");
    expect(await statusOf(alone)).toBe("Enrolled");
    expect(await resultOf(alone)).toEqual({
      result: "ten",
      source: "manual",
      locked_result: "ten",
    });
  });
});

// The kill switch test lives in serial/sibling-kill-switch.test.ts: the switch is
// global, and tests running beside it deadlocked (#384).

describe("who may edit", () => {
  test("only payments.record: every other role, an agent and a signed-out caller are refused", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);
    const everythingElse = await createThrowawayStaff(
      PERMISSIONS.filter((p) => p !== "payments.record" && p !== "audit.view"),
    );

    for (const caller of [
      await signedIn(MANAGER),
      await signedIn(ADMISSIONS),
      await signedIn(everythingElse),
      await signedIn(SEEDED_AGENT),
      anonClient(),
    ]) {
      expect(await previewSiblingFeeEdit(caller, dear, "ten")).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      });
      expect(
        await editSiblingFee(
          caller,
          { leadId: dear, value: "ten", reason: "data_entry_correction" },
          randomUUID(),
        ),
      ).toEqual({ ok: false, error: { kind: "forbidden" } });
    }

    // The Accountant holds it; a throwaway role with only payments.record too.
    const onlyPayments = await createThrowawayStaff(["payments.record"]);
    expect(
      (await previewSiblingFeeEdit(await signedIn(onlyPayments), dear, "ten"))
        .ok,
    ).toBe(true);

    expect(await resultOf(dear)).toMatchObject({
      result: "full",
      source: "auto",
    });
    expect(await resultOf(cheap)).toMatchObject({
      result: "ten",
      source: "auto",
    });
    expect(await editsOf(dear)).toEqual([]);
  });

  test("nobody writes a result or an edit row directly, the Accountant included", async () => {
    const year = await yearWithSchedule();
    const { dear } = await together(year);
    const accountant = await signedIn(ACCOUNTANT);

    const updated = await accountant
      .from("lead_sibling_results")
      .update({ result: "ten", source: "manual" })
      .eq("lead_id", dear)
      .select();
    expect(updated.error?.code).toBe("42501");
    const inserted = await accountant.from("sibling_fee_edits").insert({
      request_id: randomUUID(),
      lead_id: dear,
      staff_id: ACCOUNTANT.id,
      value: "ten",
      reason: "data_entry_correction",
      old_result: "full",
      old_source: "auto",
      new_result: "ten",
      new_source: "manual",
      changes: [],
    });
    expect(inserted.error?.code).toBe("42501");

    await inRolledBackTransaction(async (sql) => {
      await expect(
        asStaff(
          sql,
          ACCOUNTANT.id,
          "update public.lead_sibling_results set result = 'ten', source = 'manual' where lead_id = $1",
          [dear],
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await inRolledBackTransaction(async (sql) => {
      await expect(
        asStaff(
          sql,
          ACCOUNTANT.id,
          "select public.sibling_fee_edit_run($1, 'ten')",
          [dear],
        ),
      ).rejects.toThrow(/permission denied/);
    });
    expect(await resultOf(dear)).toMatchObject({
      result: "full",
      source: "auto",
    });
  });

  test("only payments.view reads the edits, since they hold fees and Seat priority; the log keeps them in the payment scope", async () => {
    const year = await yearWithSchedule();
    const { dear } = await together(year);
    await edit(dear, "ten", "data_entry_correction");

    const read = async (client: Awaited<ReturnType<typeof signedIn>>) => {
      const { data, error } = await client
        .from("sibling_fee_edits")
        .select("id, changes")
        .eq("lead_id", dear);
      if (error) throw new Error(JSON.stringify(error));
      return data.length;
    };
    // Leads but not payments, or signed out: nothing.
    expect(
      await read(
        await signedIn(
          await createThrowawayStaff(
            PERMISSIONS.filter(
              (p) => !p.startsWith("payments.") && p !== "audit.view",
            ),
          ),
        ),
      ),
    ).toBe(0);
    expect(await read(anonClient())).toBe(0);
    // payments.view alone reads it; Admissions Staff hold payments.view, as for lead_school_fee.
    expect(
      await read(await signedIn(await createThrowawayStaff(["payments.view"]))),
    ).toBe(1);
    expect(await read(await signedIn(ACCOUNTANT))).toBe(1);
    expect(await read(await signedIn(ADMISSIONS))).toBe(1);

    // The audit log, read only by the Super Admin, files it under payment, as school_fee_payments.
    const scopes = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query(
          "select distinct scope from public.audit_log where table_name = $1 and lead_id = $2",
          ["sibling_fee_edits", dear],
        )
      ).rows.map((r) => r.scope),
    );
    expect(scopes).toEqual(["payment"]);
  });

  test("refuses an unchanged, closed, missing or malformed edit, and a reused request", async () => {
    const year = await yearWithSchedule();
    const { dear, cheap } = await together(year);
    const accountant = await signedIn(ACCOUNTANT);
    const save = (
      input: Parameters<typeof editSiblingFee>[1],
      requestId = randomUUID(),
    ) => editSiblingFee(accountant, input, requestId);

    expect(
      await save({
        leadId: dear,
        value: "automatic",
        reason: "data_entry_correction",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "unchanged" },
    });
    expect(await previewSiblingFeeEdit(accountant, dear, "automatic")).toEqual({
      ok: false,
      error: { kind: "unchanged" },
    });
    expect(
      await save({
        leadId: dear,
        value: "nine" as SiblingFeeEditValue,
        reason: "data_entry_correction",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "invalid", field: "value" },
    });
    expect(
      await save({
        leadId: dear,
        value: "ten",
        reason: "because" as SiblingFeeEditReason,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "invalid", field: "reason" },
    });
    expect(
      await save({
        leadId: dear,
        value: "ten",
        reason: null as unknown as SiblingFeeEditReason,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "invalid", field: "reason" },
    });
    expect(
      await save({
        leadId: dear,
        value: "ten",
        reason: "data_entry_correction",
        note: "x".repeat(1001),
      }),
    ).toEqual({
      ok: false,
      error: { kind: "invalid", field: "note" },
    });
    expect(
      await save({
        leadId: randomUUID(),
        value: "ten",
        reason: "data_entry_correction",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });

    // A retry hands back the first answer and saves once.
    const requestId = randomUUID();
    const first = await save(
      { leadId: dear, value: "ten", reason: "data_entry_correction" },
      requestId,
    );
    const again = await save(
      { leadId: dear, value: "ten", reason: "data_entry_correction" },
      requestId,
    );
    expect(first.ok && again.ok).toBe(true);
    expect(again).toEqual(first);
    expect(await editsOf(dear)).toHaveLength(1);
    expect(
      await save(
        { leadId: dear, value: "full", reason: "data_entry_correction" },
        requestId,
      ),
    ).toEqual({
      ok: false,
      error: { kind: "request-reused" },
    });
    expect(
      await save({
        leadId: dear,
        value: "ten",
        reason: "data_entry_correction",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "unchanged" },
    });

    expect(
      (
        await declineLead(await signedIn(MANAGER), cheap, {
          reason: "Other",
          explanation: "For the test.",
        })
      ).ok,
    ).toBe(true);
    expect(
      await save({
        leadId: cheap,
        value: "full",
        reason: "data_entry_correction",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "lead-closed" },
    });
    expect(await previewSiblingFeeEdit(accountant, cheap, "full")).toEqual({
      ok: false,
      error: { kind: "lead-closed" },
    });
  });

  test("one request_id used at the same moment on two families is a reused request, and the second edit saves nothing", async () => {
    const year = await yearWithSchedule();
    const first = await together(year);
    const second = await together(year);
    const requestId = randomUUID();
    const feeBefore = (await feeOf(second.cheap)).schoolFee;

    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await sql.connect();
    try {
      await sql.query("begin");
      await asStaff(
        sql,
        ACCOUNTANT.id,
        "select public.edit_sibling_fee($1, 'full', 'data_entry_correction', null, $2)",
        [first.cheap, requestId],
      );
      const pid = (
        await sql.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0].pid;

      // The second edit finds no row for the request yet, and then waits on the first's uncommitted one.
      const racing = editSiblingFee(
        await signedIn(ACCOUNTANT),
        {
          leadId: second.cheap,
          value: "full",
          reason: "data_entry_correction",
        },
        requestId,
      );
      await inRolledBackTransaction(async (watch) => {
        for (;;) {
          const { rows } = await watch.query<{ waiting: boolean }>(
            "select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting",
            [pid],
          );
          if (rows[0].waiting) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
      await sql.query("commit");

      expect(await racing).toEqual({
        ok: false,
        error: { kind: "request-reused" },
      });
    } finally {
      await sql.query("rollback").catch(() => {});
      await sql.end();
    }
    expect(await editsOf(first.cheap)).toHaveLength(1);
    expect(await editsOf(second.cheap)).toHaveLength(0);
    expect(await resultOf(second.cheap)).toMatchObject({
      source: "auto",
      result: "ten",
    });
    expect((await feeOf(second.cheap)).schoolFee).toBe(feeBefore);
  });
});

