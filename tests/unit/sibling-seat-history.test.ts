import { describe, expect, it } from "vitest"

import { describeLeadHistory, type HistoryNames } from "@/app/staff/applicants/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

// The sibling group, Sibling discount, Manual Sibling fee edit, seat, stream
// request and Sibling request entries of a lead's history (#428), in the words
// the owner approved in the History wording prototype.

const LEAD = "1ead0000-0000-4000-8000-000000000081"
const ASHA = "1ead0000-0000-4000-8000-000000000080"
const GROUP = "f4455eb5-a731-47a5-81d0-1a7a67f1f80c"
const OTHER_GROUP = "0b7d1c52-6e0a-4c1f-9a43-2f5d8e61b7a9"
const BOYS = "7c1e9b20-55d4-4a8e-b0f2-1d6a3c7e9f41"
const GIRLS = "9e4a2f6c-0b13-4d77-8c5e-6a1f2b9d3e08"
const REQUEST = "5e1d77a0-3b2c-4f19-8d61-0a9c4e2b7f35"
const AT = "2026-11-19T07:14:03.518+00:00"

// Girls was there before AT. Boys was opened on the Tuesday after it, at a
// time written here with a trailing zero, which the database trims.
const names: HistoryNames = {
  leads: { [ASHA]: "Asha Kibwana · ADMSN-90080" },
  streams: { [BOYS]: "KG 2 A (Boys)", [GIRLS]: "KG 2 A (Girls)" },
  streamOpenedAt: { [BOYS]: "2026-11-24T08:15:02.3850+00:00", [GIRLS]: "2026-11-02T06:00:00+00:00" },
}

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })
const created = (fields: Record<string, unknown>) => Object.entries(fields).map(([field, to]) => change(field, null, to))

function entry(record: string, action: "insert" | "update", changes: LeadHistoryEntry["changes"], id = 1, recordId = "row"): LeadHistoryEntry {
  return { id, at: AT, actor: "Test Admissions", record, recordId, action, changes }
}

// Each entry as it reads on screen: its summary and its lines.
function read(entries: LeadHistoryEntry[], known: HistoryNames = names) {
  return describeLeadHistory(entries, {}, null, known).map((e) => ({
    summary: e.summary,
    lines: e.changes.map((c) => `${c.label}: ${c.from === null ? "" : `${c.from} → `}${c.to}`),
  }))
}

describe("a sibling group entry", () => {
  it("names the sibling and says why the child counts as one, hiding the ids and times", () => {
    const [joined] = read([
      entry(
        "sibling_group_members",
        "insert",
        created({
          cause: "visit_completion",
          basis: "matched",
          lead_id: LEAD,
          group_id: GROUP,
          legacy: false,
          joined_at: AT,
          updated_at: AT,
          sibling_of_lead_id: ASHA,
          sibling_choice_made: true,
        }),
      ),
    ])
    expect(joined).toEqual({
      summary: "added the applicant to a sibling group",
      lines: [
        "Sibling of: Asha Kibwana · ADMSN-90080",
        "Counts as a sibling: Yes: the fathers’ names match",
        "Because: Check-in completed the Admission form details",
      ],
    })
  })

  it("hides that a member is a Legacy member, saying only that sibling groups began", () => {
    const [legacy] = read([
      entry("sibling_group_members", "insert", created({ cause: "migration", legacy: true, lead_id: LEAD, group_id: GROUP, joined_at: AT })),
    ])
    expect(legacy).toEqual({ summary: "added the applicant to a sibling group", lines: ["Because: Sibling groups began"] })
  })

  // Every write sets updated_at to now(), the same all through one save, so
  // a later write in the same save leaves it unchanged.
  const T0 = "2026-11-12T05:02:09.880+00:00"
  const T1 = "2026-11-20T08:00:00.000+00:00"
  const T2 = "2026-11-20T08:00:01.000+00:00"
  const group = (id: number, changes: LeadHistoryEntry["changes"]) => entry("sibling_group_members", "update", changes, id)

  // Registration saves every child's answer as a membership with no group,
  // then links the children staff named a sibling of, in the same save.
  it("reads a registration that named a sibling as one new membership", () => {
    const answer = entry("sibling_group_members", "insert", created({ cause: "registration", legacy: false, sibling_choice_made: true, updated_at: T1 }), 1)
    const link = group(2, [change("group_id", null, GROUP), change("sibling_of_lead_id", null, ASHA), change("basis", null, "matched"), change("cause", "registration", "sibling_link")])
    expect(read([link, answer])).toEqual([
      {
        summary: "added the applicant to a sibling group",
        lines: ["Sibling of: Asha Kibwana · ADMSN-90080", "Counts as a sibling: Yes: the fathers’ names match", "Because: Staff chose Sibling of"],
      },
    ])
  })

  // Check-in marks the Admission form's membership answered, takes the child
  // out of its Family's legacy group, then makes the links staff chose.
  describe("a check-in", () => {
    const fromForm = (legacy: boolean) =>
      entry("sibling_group_members", "insert", created({ cause: legacy ? "migration" : "lead_created", legacy, group_id: legacy ? OTHER_GROUP : null, updated_at: T0 }), 1)
    const answer = group(2, [change("sibling_choice_made", false, true), change("updated_at", T0, T1)])
    const leaveLegacy = group(3, [change("group_id", OTHER_GROUP, null), change("legacy", true, false), change("cause", "migration", "visit_completion")])
    const link = (id: number, from: string) => group(id, [change("group_id", null, GROUP), change("sibling_of_lead_id", null, ASHA), change("basis", null, "matched"), change("cause", from, "sibling_link")])

    it("answered Not a sibling, with no group, reads as being in no sibling group", () => {
      expect(read([answer, fromForm(false)])[0]).toEqual({
        summary: "recorded that the applicant is in no sibling group",
        lines: ["Because: Check-in completed the Admission form details"],
      })
    })

    // The first sibling groups were made before the history recorded them, so
    // such a membership has no insert here. Choosing Sibling of then moved it
    // off the old family rule without changing its group, which no entry names.
    it("of a membership whose group the history never showed doesn't say it is in no sibling group", () => {
      const converted = group(1, [change("legacy", true, false), change("basis", null, "matched"), change("cause", "migration", "sibling_link"), change("updated_at", "2026-11-05T09:20:00.000+00:00", T0)])
      expect(read([answer, converted])).toEqual([
        { summary: "changed the applicant’s sibling group details", lines: ["Because: Check-in completed the Admission form details"] },
        {
          summary: "moved the applicant from the old family rule to the Sibling fee rule",
          lines: ["Counts as a sibling: None → Yes: the fathers’ names match", "Because: Staff chose Sibling of"],
        },
      ])
    })

    it("that chose a sibling reads as the link", () => {
      expect(read([link(3, "lead_created"), answer, fromForm(false)])[0]).toEqual({
        summary: "added the applicant to a sibling group",
        lines: ["Sibling of: None → Asha Kibwana · ADMSN-90080", "Counts as a sibling: None → Yes: the fathers’ names match", "Because: Staff chose Sibling of"],
      })
    })

    it("of a Legacy member answered Not a sibling reads as leaving the group", () => {
      expect(read([leaveLegacy, answer, fromForm(true)])).toEqual([
        { summary: "took the applicant out of their sibling group", lines: ["Because: Check-in completed the Admission form details"] },
        { summary: "added the applicant to a sibling group", lines: ["Because: Sibling groups began"] },
      ])
    })

    it("of a Legacy member that chose a sibling reads as one move", () => {
      expect(read([link(4, "visit_completion"), leaveLegacy, answer, fromForm(true)]).map((e) => e.summary)).toEqual([
        "moved the applicant to another sibling group",
        "added the applicant to a sibling group",
      ])
    })

    it("stays apart from a link made in a later save, however soon", () => {
      const later = group(3, [change("group_id", null, GROUP), change("cause", "lead_created", "sibling_link"), change("updated_at", T1, T2)])
      expect(read([later, answer, fromForm(false)]).map((e) => e.summary)).toEqual([
        "added the applicant to a sibling group",
        "recorded that the applicant is in no sibling group",
        "recorded that the applicant is in no sibling group",
      ])
    })
  })

  it("records a Not a sibling answer as being in no sibling group", () => {
    const [none] = read([
      entry("sibling_group_members", "insert", created({ cause: "registration", lead_id: LEAD, updated_at: AT, sibling_choice_made: true })),
    ])
    expect(none).toEqual({
      summary: "recorded that the applicant is in no sibling group",
      lines: ["Because: The student was registered at the desk"],
    })
  })

  it.each([
    ["leaving the group", [change("group_id", GROUP, null), change("joined_at", AT, null), change("cause", "lead_created", "family")], "took the applicant out of their sibling group", ["Because: The applicant's Family changed"]],
    ["a merge", [change("group_id", OTHER_GROUP, GROUP), change("cause", "visit_completion", "merge")], "moved the applicant to another sibling group", ["Because: Two sibling groups were joined"]],
    [
      "the end of the old family rule",
      [change("legacy", true, false), change("basis", null, "matched"), change("cause", "migration", "father_name")],
      "moved the applicant from the old family rule to the Sibling fee rule",
      ["Counts as a sibling: None → Yes: the fathers’ names match", "Because: The father’s full name was corrected"],
    ],
    [
      "a decided Sibling request",
      [change("basis", "request_needed", "granted"), change("cause", "sibling_link", "sibling_request")],
      "changed the applicant’s sibling group details",
      ["Counts as a sibling: Not yet: needs a Sibling request → Yes: a Sibling request was granted", "Because: A Sibling request was decided"],
    ],
    [
      "a refused Sibling request",
      [change("basis", "request_needed", "refused")],
      "changed the applicant’s sibling group details",
      ["Counts as a sibling: Not yet: needs a Sibling request → No: the Sibling request was refused"],
    ],
  ])("reads %s", (_case, changes, summary, lines) => {
    expect(read([entry("sibling_group_members", "update", changes)])).toEqual([{ summary, lines }])
  })
})

describe("a Sibling discount entry", () => {
  it("uses its own labels, not the interview result's or a follow-up's", () => {
    const [first] = read([
      entry("lead_sibling_results", "insert", created({ result: "ten", cause: "migration", source: "legacy", lead_id: LEAD, updated_at: AT })),
    ])
    expect(first).toEqual({
      summary: "worked out the applicant’s Sibling discount",
      lines: ["Sibling discount: 10% off", "Decided by: The old family rule", "Because: Sibling groups began"],
    })
  })

  it("reads a recompute cause as an Enrolled entry does", () => {
    const [changed] = read([
      entry("lead_sibling_results", "update", [change("result", "ten", "none"), change("cause", "lead_created", "family"), change("updated_at", AT, AT)]),
    ])
    expect(changed).toEqual({
      summary: "changed the applicant’s Sibling discount",
      lines: ["Sibling discount: 10% off → No Sibling discount", "Because: The applicant's Family changed"],
    })
  })

  it("says a manual result was fixed at enrolment though its source stays Set by hand", () => {
    const [fixed] = read([entry("lead_sibling_results", "update", [change("cause", "sibling", "enrolled"), change("locked_at", null, AT), change("locked_result", null, "full")])])
    expect(fixed).toEqual({ summary: "fixed the applicant’s Sibling discount when they were Enrolled", lines: ["Because: The student was Enrolled"] })
  })

  it("says a result first stored at enrolment was fixed then", () => {
    const [fixed] = read([entry("lead_sibling_results", "insert", created({ result: "full", source: "locked", locked_result: "full", locked_at: AT, cause: "enrolled" }))])
    expect(fixed).toEqual({
      summary: "fixed the applicant’s Sibling discount when they were Enrolled",
      lines: ["Sibling discount: Full fee", "Decided by: Fixed at enrolment", "Because: The student was Enrolled"],
    })
  })

  it("reads Back to automatic after enrolment as a change, not a new fix", () => {
    const [back] = read([entry("lead_sibling_results", "update", [change("source", "manual", "locked"), change("result", "ten", "full"), change("cause", "enrolled", "sibling")])])
    expect(back.summary).toBe("changed the applicant’s Sibling discount")
  })

  it("says the result was fixed at enrolment, hiding the copy it keeps", () => {
    const [fixed] = read([
      entry("lead_sibling_results", "update", [
        change("cause", "sibling", "payment"),
        change("source", "auto", "locked"),
        change("locked_at", null, AT),
        change("updated_at", AT, AT),
        change("locked_result", null, "ten"),
      ]),
    ])
    expect(fixed).toEqual({
      summary: "fixed the applicant’s Sibling discount when they were Enrolled",
      lines: ["Decided by: The Sibling fee rule → Fixed at enrolment", "Because: A school-fee payment was recorded"],
    })
  })
})

describe("a Manual Sibling fee edit entry", () => {
  it("reads the edit's old and new result as one line, hiding who else it changed", () => {
    const [edit] = read([
      entry(
        "sibling_fee_edits",
        "insert",
        created({
          note: "Asha is moving to another school, so Daudi pays the full fee.",
          value: "full",
          reason: "full_fee_sibling_not_enrolled",
          changes: [{ lead_id: LEAD, edited: true }],
          lead_id: LEAD,
          staff_id: "a1a1a1a1-0000-4000-8000-000000000004",
          new_result: "full",
          new_source: "manual",
          old_result: "ten",
          old_source: "auto",
          request_id: REQUEST,
        }),
      ),
    ])
    expect(edit).toEqual({
      summary: "changed the Sibling discount by hand",
      lines: [
        "Set to: Full fee",
        "Sibling discount: 10% off → Full fee",
        "Reason: Full-fee sibling did not enrol",
        "Note: Asha is moving to another school, so Daudi pays the full fee.",
      ],
    })
  })

  it("says Back to automatic", () => {
    const [edit] = read([entry("sibling_fee_edits", "insert", created({ value: "automatic", reason: "data_entry_correction", new_result: "ten", old_result: "full" }))])
    expect(edit.lines).toEqual(["Set to: Back to automatic", "Sibling discount: Full fee → 10% off", "Reason: Data-entry correction"])
  })
})

describe("a seat entry", () => {
  const waiting = { waiting_since: AT, waiting_xid: "8412377", waiting_year: 2027, waiting_class: "STD 3" }

  it("names the stream a child is placed in, hiding the ids and times", () => {
    expect(read([entry("seat_placements", "insert", created({ cause: "migration", lead_id: LEAD, stream_id: BOYS, changed_at: AT }))])).toEqual([
      { summary: "placed the applicant in KG 2 A (Boys)", lines: ["Because: The school moved to streams"] },
    ])
  })

  it("names both streams of a move", () => {
    expect(read([entry("seat_placements", "update", [change("cause", "payment", "gender"), change("stream_id", BOYS, GIRLS), change("changed_at", AT, AT)])])).toEqual([
      { summary: "moved the applicant from KG 2 A (Boys) to KG 2 A (Girls)", lines: ["Because: Boy or girl was corrected"] },
    ])
  })

  it("puts a child with no seat free on Waiting for a stream, hiding the queue's fields", () => {
    expect(read([entry("seat_placements", "insert", created({ cause: "payment", lead_id: LEAD, changed_at: AT, ...waiting }))])).toEqual([
      { summary: "put the applicant on Waiting for a stream", lines: ["Because: A school-fee payment was recorded"] },
    ])
  })

  it("places a waiting child when a new stream opens", () => {
    const changes = [
      change("cause", "payment", "stream_opened"),
      change("stream_id", null, BOYS),
      ...Object.entries(waiting).map(([field, value]) => change(field, value, null)),
    ]
    expect(read([entry("seat_placements", "update", changes)])).toEqual([
      { summary: "placed the applicant in KG 2 A (Boys)", lines: ["Because: A new stream was opened"] },
    ])
  })

  it.each([
    ["a placed child", [change("cause", "payment", "declined"), change("stream_id", BOYS, null)], "Because: The application was declined"],
    ["a waiting child", [change("cause", "payment", "seat_freed"), ...Object.entries(waiting).map(([field, value]) => change(field, value, null))], "Because: A seat came free"],
  ])("releases the seat of %s", (_case, changes, because) => {
    expect(read([entry("seat_placements", "update", changes)])).toEqual([{ summary: "released the applicant’s seat", lines: [because] }])
  })

  it("still says why when a change kept the cause before it", () => {
    const placed = entry("seat_placements", "insert", created({ cause: "payment", stream_id: BOYS }), 1, "seat")
    const moved = entry("seat_placements", "update", [change("stream_id", BOYS, GIRLS), change("changed_at", AT, "2026-11-21T08:00:00Z")], 2, "seat")
    expect(read([moved, placed])[0]).toEqual({
      summary: "moved the applicant from KG 2 A (Boys) to KG 2 A (Girls)",
      lines: ["Because: A school-fee payment was recorded"],
    })
  })

  it("shows a stream it couldn't name by its id", () => {
    const [placed] = describeLeadHistory([entry("seat_placements", "insert", created({ stream_id: "unknown-stream", cause: "migration" }))], {})
    expect(placed.summary).toBe("placed the applicant in unknown-stream")
  })
})

describe("a move between streams, saved as a release and a placement", () => {
  // The placement in the same save leaves changed_at as the release set it.
  const release = entry("seat_placements", "update", [change("cause", "payment", "gender"), change("stream_id", BOYS, null), change("changed_at", AT, "2026-11-20T08:15:02.010Z")], 1, "seat")
  const placement = (changes: LeadHistoryEntry["changes"]) => entry("seat_placements", "update", [change("stream_id", null, GIRLS), ...changes], 2, "seat")

  it("reads as one move, saying why the child left the old stream", () => {
    expect(read([placement([]), release])).toEqual([{ summary: "moved the applicant from KG 2 A (Boys) to KG 2 A (Girls)", lines: ["Because: Boy or girl was corrected"] }])
  })

  // The row's cause was already `gender`, so the release records no cause
  // change, and the only one in the save is the placement's.
  it("says why the child left when the release kept the cause the row already had", () => {
    const kept = entry("seat_placements", "update", [change("stream_id", BOYS, null), change("changed_at", AT, "2026-11-20T08:15:02.010Z")], 1, "seat")
    expect(read([placement([change("cause", "gender", "stream_opened")]), kept])).toEqual([
      { summary: "moved the applicant from KG 2 A (Boys) to KG 2 A (Girls)", lines: ["Because: Boy or girl was corrected"] },
    ])
  })

  it("stays two entries when the placement came in a later save, however soon", () => {
    const later = placement([change("cause", "gender", "stream_opened"), change("changed_at", "2026-11-20T08:15:02.010Z", "2026-11-20T08:15:03.500Z")])
    expect(read([later, release])).toEqual([
      { summary: "placed the applicant in KG 2 A (Girls)", lines: ["Because: A new stream was opened"] },
      { summary: "released the applicant’s seat", lines: ["Because: Boy or girl was corrected"] },
    ])
  })
})

describe("a request for a new stream", () => {
  it.each([
    ["Boys", "Needs: A stream for boys"],
    [null, "Needs: Any stream"],
  ])("says what it needs: %s", (need, line) => {
    const [sent] = read([
      entry(
        "stream_requests",
        "insert",
        created({ class_name: "STD 3", enrollment_year: 2027, need, lead_id: LEAD, requested_at: AT, requested_by: "a1a1a1a1-0000-4000-8000-000000000003" }),
      ),
    ])
    expect(sent).toEqual({ summary: "sent a request to open a new stream", lines: ["Class: STD 3", "Enrollment year: 2027", line] })
  })

  // A request sent on a Monday, and the entry that closes it with a stream
  // at a given time. Opening a stream closes the requests it answers in the
  // same save, so both rows carry that save's time.
  const sent = entry("stream_requests", "insert", created({ class_name: "KG 2", enrollment_year: 2027, need: null, lead_id: LEAD, requested_at: "2026-11-23T06:40:11.902114+00:00" }), 1, "request")
  const closed = (stream: string, at: string) => entry("stream_requests", "update", [change("resolved_at", null, at), change("resolved_by_stream_id", null, stream)], 2, "request")
  const hidden = { summary: "closed the request for a new stream", lines: [] }

  // Boys was opened at 08:15:02.385 UTC on Tuesday.
  it.each([
    ["with Z", "2026-11-24T08:15:02.385Z"],
    ["with every digit", "2026-11-24T08:15:02.385000+00:00"],
    ["in Tanzania's time", "2026-11-24T11:15:02.385+03:00"],
  ])("names the stream opened in the save that closed it, its time written %s", (_case, at) => {
    expect(read([closed(BOYS, at), sent])[0]).toEqual({ summary: "closed the request for a new stream", lines: ["Stream opened: None → KG 2 A (Boys)"] })
  })

  // Boys opened on Tuesday with one seat, which a child already waiting
  // took. The request stayed open until a seat was added on Friday.
  it("doesn't say a stream was opened when one opened after the request gained a seat later", () => {
    expect(read([closed(BOYS, "2026-11-27T07:02:48.610233+00:00"), sent])[0]).toEqual(hidden)
  })

  it("doesn't say a stream was opened when the two times are a microsecond apart", () => {
    expect(read([closed(BOYS, "2026-11-24T08:15:02.385001+00:00"), sent])[0]).toEqual(hidden)
  })

  it("doesn't say a stream was opened when one already there gained seats", () => {
    expect(read([closed(GIRLS, "2026-11-24T08:15:02.385+00:00"), sent])[0]).toEqual(hidden)
  })

  it.each([
    ["the stream's opening time couldn't be read", closed(BOYS, "2026-11-24T08:15:02.385+00:00"), { streams: names.streams }],
    ["the closing time isn't one the database writes", closed(BOYS, "24 November 2026"), names],
  ])("doesn't say a stream was opened when %s", (_case, closing, known) => {
    expect(read([closing, sent], known)[0]).toEqual(hidden)
  })
})

describe("a Sibling request", () => {
  const sent = entry(
    "discount_requests",
    "insert",
    created({
      note: "The family will bring both birth certificates on Monday.",
      kind: "sibling",
      state: "pending",
      group_id: GROUP,
      sibling_of_lead_id: ASHA,
      lead_id: LEAD,
      requested_by: "staff",
      requested_at: AT,
      request_id: REQUEST,
    }),
    1,
    REQUEST,
  )
  const later = (id: number, changes: LeadHistoryEntry["changes"]) => entry("discount_requests", "update", changes, id, REQUEST)

  it("is sent, granted and its 10% applied, in its own words", () => {
    expect(
      read([
        later(3, [change("fee_edit", "needed", "applied"), change("fee_edit_closed_by", null, "staff"), change("fee_edit_closed_at", null, AT)]),
        later(2, [change("state", "pending", "granted"), change("fee_edit", null, "needed"), change("decided_by", null, "staff"), change("decided_at", null, AT)]),
        sent,
      ]),
    ).toEqual([
      { summary: "applied the 10% for the granted Sibling request", lines: ["Fee edit: Needed → 10% applied"] },
      { summary: "granted the Sibling request", lines: ["Request: Pending → Granted", "Fee edit: None → Needed"] },
      {
        summary: "sent a Sibling request",
        lines: [
          "Note for the Manager: The family will bring both birth certificates on Monday.",
          "Discount: Sibling",
          "Request: Pending",
          "Sibling of: Asha Kibwana · ADMSN-90080",
        ],
      },
    ])
  })

  it("keeps the fee edit's own reason off the request when the 10% is applied", () => {
    const applied = later(3, [
      change("fee_edit", "needed", "applied"),
      change("fee_edit_closed_at", null, AT),
      change("fee_edit_reason", null, "sibling_proof_after_enrolment"),
    ])
    expect(read([applied, sent])[0]).toEqual({ summary: "applied the 10% for the granted Sibling request", lines: ["Fee edit: Needed → 10% applied"] })
  })

  it("is refused in its own words", () => {
    expect(read([later(2, [change("state", "pending", "refused"), change("refusal_reason", null, "No proof.")]), sent])[0].summary).toBe(
      "refused the Sibling request",
    )
  })

  it("closes without a decision, and its fee edit is dismissed with a reason", () => {
    expect(
      read([
        later(3, [
          change("fee_edit", "needed", "dismissed"),
          change("fee_edit_closed_by", null, "staff"),
          change("fee_edit_closed_at", null, AT),
          change("fee_edit_reason", null, "The family paid the full fee before the request was granted."),
        ]),
        later(2, [change("state", "pending", "withdrawn"), change("withdrawn_reason", null, "left_group"), change("withdrawn_by", null, "staff")]),
        sent,
      ]).slice(0, 2),
    ).toEqual([
      {
        summary: "dismissed the fee edit for the granted Sibling request",
        lines: ["Fee edit: Needed → Dismissed", "Reason for dismissing: None → The family paid the full fee before the request was granted."],
      },
      { summary: "closed the Sibling request without a decision", lines: ["Request: Pending → Withdrawn", "Closed because: None → The applicant left the sibling group"] },
    ])
  })

  it("leaves a Staff child request's words as they were", () => {
    const staffChild = entry("discount_requests", "insert", created({ kind: "staff_child", note: "Mother teaches STD 4.", state: "pending" }), 1, "other")
    const granted = entry("discount_requests", "update", [change("state", "pending", "granted")], 2, "other")
    expect(read([granted, staffChild]).map((e) => e.summary)).toEqual(["granted the discount request", "requested a Staff child discount"])
  })
})

describe("the applicant", () => {
  it("labels Boy or girl and hides the custodian's relationship kept on the lead", () => {
    const [corrected] = read([entry("lead", "update", [change("gender", "Boy", "Girl"), change("custodian_relationship_own", true, false)])])
    expect(corrected).toEqual({ summary: "changed the application", lines: ["Boy or girl: Boy → Girl"] })
  })

  it("keeps a follow-up's cause and an interview's result in their own words", () => {
    const [interview] = read([entry("interviews", "update", [change("result", null, "Passed")])])
    expect(interview.lines).toEqual(["Interview result: None → Passed"])
  })
})
