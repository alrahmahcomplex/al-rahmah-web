// The permanent grant list (#188): everything the `anon` and `authenticated`
// API roles can reach in the schemas the API exposes, and what the seeded
// Marketing Agent gets from each. tests/integration/api-surface.test.ts reads
// the database's actual grants and policies and fails on anything missing
// from here, on any entry here that no longer exists, and on any answer that
// differs from the one recorded.
//
// Adding a function, table or policy the API roles can reach means adding
// its entry here, by hand, after checking what an agent gets. An agent
// session must get nothing: a refusal, false, zero or no rows. The only other
// answers are public facts anyone may know, such as how a phone number is
// normalised.
//
// Sample arguments are SQL expressions, evaluated as the database owner
// before the call, in the function's parameter order. Each is a call a staff
// member holding every permission makes without error, and the test checks
// that, so a refusal comes from who is asking and not from a bad argument.
// An entry whose call needs state the seeds don't hold creates it in `setup`.
// Trigger functions are exempt: no role can call them directly.
//
// Table privileges include PostgreSQL 17's MAINTAIN (VACUUM, ANALYZE,
// REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE). The API roles
// hold it, with REFERENCES and TRIGGER, from Supabase's default grants. The
// API can't use any of them: PostgREST runs none of those commands, and no
// function an API role can call runs one as its caller.

export type ApiRole = "anon" | "authenticated"

export type AgentAnswer =
  // The error message the call raises.
  | { refused: string }
  // Every row the call returns, as JSON: a scalar function gives one row.
  | { returns: unknown[] }
  // A public answer that changes over time, with why it holds no staff data.
  | { anyAnswer: string }

export type FunctionEntry = {
  roles: ApiRole[]
  // SQL run as the database owner, with the system as audit actor, before the
  // sample arguments are evaluated, in the same rolled-back transaction.
  setup?: string
  args: Record<string, string>
  agent: AgentAnswer
  // A deprecated overload: the date (YYYY-MM-DD) by which it must be gone.
  removeBy?: string
}

export type RelationEntry = { authenticated: string[]; anon: string[] }

export type PolicyEntry = {
  command: string
  roles: string[]
  using: string | null
  check: string | null
}

export const FUNCTIONS: Record<string, FunctionEntry> = {
  'graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb)': {
    roles: ["anon", "authenticated"],
    args: {
      operationName: "null",
      query: "'{ leadsCollection { edges { node { id } } } }'",
      variables: "null",
      extensions: "null",
    },
    agent: {
      returns: [{ errors: [{ message: "pg_graphql extension is not enabled." }] }],
    },
    // Local and CI databases run without pg_graphql. Row security would still
    // hide every row from an agent if it were enabled.
  },
  // An agent row's account state (#191): null for anyone without leads.view.
  "public.account_state(agent marketing_agents)": {
    roles: ["authenticated"],
    args: { agent: "(select a from public.marketing_agents a where a.id = 'a4a4a4a4-0000-4000-8000-000000000002')" },
    agent: { returns: [null] },
  },
  "public.adjust_school_fee_payment(payment_id uuid, reason text, voided boolean, payment_type text, amount numeric, paid_on date, note text, request_id uuid)":
    {
      roles: ["authenticated"],
      args: {
        payment_id: "'fee00000-0000-4000-8000-000000000902'",
        reason: "'Wrong amount'",
        voided: "false",
        payment_type: "'initial_deposit'",
        amount: "100000",
        paid_on: "current_date",
        note: "'A note'",
        request_id: "'00000000-0000-4000-8000-000000000188'",
      },
      agent: { refused: "not_permitted" },
    },
  "public.agent_access_status()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.agent_account_counts()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  // The "Awaiting email confirmation" queue (#193).
  "public.agent_email_claim_queue()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  // The agents behind one of an invite batch's counts (#192).
  "public.agent_invite_batch_agents(batch_id uuid, outcome text)": {
    roles: ["authenticated"],
    args: { batch_id: "'b7b7b7b7-0000-4000-8000-000000000192'", outcome: "'waiting'" },
    agent: { refused: "not_permitted" },
  },
  "public.agent_invite_batch_report(batch_id uuid, import_batch_id uuid)": {
    roles: ["authenticated"],
    args: { batch_id: "null", import_batch_id: "null" },
    agent: { refused: "not_permitted" },
  },
  "public.agent_invite_budget_used()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.agent_invites(agent_ids uuid[])": {
    roles: ["authenticated"],
    args: { agent_ids: "array['a4a4a4a4-0000-4000-8000-000000000002']::uuid[]" },
    agent: { refused: "not_permitted" },
  },
  "public.agent_recreate_preview(agent_id uuid)": {
    roles: ["authenticated"],
    args: { agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'" },
    agent: { refused: "not_permitted" },
  },
  // Typed codes a sign-up didn't adopt (#193).
  "public.agent_sign_up_notes(agent_ids uuid[])": {
    roles: ["authenticated"],
    args: { agent_ids: "array['a4a4a4a4-0000-4000-8000-000000000002']::uuid[]" },
    agent: { refused: "not_permitted" },
  },
  "public.agent_status_fee_impact(agent_id uuid, kind text)": {
    roles: ["authenticated"],
    args: {
      agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'",
      kind: "'switched_off'",
    },
    agent: { refused: "not_permitted" },
  },
  // The students using the signed-in agent's own code (#195): their own
  // leads' allowed fields only. The seeded agent's code has none. Staff and
  // visitors get null.
  "public.agent_students(search text, page_limit integer, page_offset integer)": {
    roles: ["authenticated"],
    args: { search: "null", page_limit: "20", page_offset: "0" },
    agent: { returns: [{ state: "active", code: "SAM-403", total: 0, matched: 0, students: [] }] },
  },
  "public.approve_marketing_agent(agent_id uuid)": {
    roles: ["authenticated"],
    args: { agent_id: "'a4a4a4a4-0000-4000-8000-000000000001'" },
    agent: { refused: "not_permitted" },
  },
  "public.approve_reopening_request(request_id uuid, enrol_without_retake boolean)": {
    roles: ["authenticated"],
    args: {
      request_id: "'5e0e0000-0000-4000-8000-000000000080'",
      enrol_without_retake: "null",
    },
    agent: { refused: "not_permitted" },
  },
  // The system audit screen (#237): audit.view alone.
  "public.audit_entries(from_day date, to_day date, actor text, area text, record text, page_limit integer, page_offset integer)": {
    roles: ["authenticated"],
    args: {
      from_day: "null",
      to_day: "null",
      actor: "null",
      area: "null",
      record: "'ADMSN-90001'",
      page_limit: "50",
      page_offset: "0",
    },
    agent: { refused: "forbidden" },
  },
  "public.assign_staff_role(staff_id uuid, role_id uuid)": {
    roles: ["authenticated"],
    args: {
      staff_id: "'a1a1a1a1-0000-4000-8000-000000000003'",
      role_id: "(select id from public.roles where name = 'Accountant')",
    },
    agent: { refused: "not_permitted" },
  },
  "public.change_follow_up_date(follow_up_id uuid, due_on date, reason text, note text)": {
    roles: ["authenticated"],
    args: {
      follow_up_id: "'f0110000-0000-4000-8000-000000000002'",
      due_on: "current_date + 7",
      reason: "'A sample reason'",
      note: "'A note'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.change_marketing_agent_status(agent_id uuid, kind text, reason text)": {
    roles: ["authenticated"],
    args: {
      agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'",
      kind: "'switched_off'",
      reason: "'A sample reason'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.check_agent_import(rows jsonb)": {
    roles: ["authenticated"],
    args: { rows: "'[]'::jsonb" },
    agent: { refused: "not_permitted" },
  },
  "public.check_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)": {
    roles: ["authenticated"],
    args: {
      full_name: "'Sample Person'",
      phone: "'0700000101'",
      whatsapp: "null",
      email: "'sample@example.test'",
      code: "'BJN-402'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.confirm_agent_import(file_name text, row_count integer, rows jsonb)": {
    roles: ["authenticated"],
    args: {
      file_name: "'agents.csv'",
      row_count: "1",
      rows: `'[{"sheet_row": 2, "code": "SAP-188", "full_name": "Sample Agent Person", "phone": "+255700000188", "whatsapp": null, "email": null, "expected": {"verdict": "create"}}]'::jsonb`,
    },
    agent: { refused: "not_permitted" },
  },
  "public.confirm_family_match(lead_id uuid, expected_lead_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000049'",
      expected_lead_ids: "array['1ead0000-0000-4000-8000-000000000049', '1ead0000-0000-4000-8000-000000000050']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.correct_staff_name(staff_id uuid, full_name text)": {
    roles: ["authenticated"],
    args: {
      staff_id: "'a1a1a1a1-0000-4000-8000-000000000003'",
      full_name: "'Sample Person'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.correct_visit_date(lead_id uuid, visited_on date)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000002'",
      visited_on: "current_date",
    },
    agent: { refused: "not_permitted" },
  },
  "public.create_lead(start_kind text, existing_contact_id uuid, new_contact jsonb, student_details jsonb, visited_on date, also_check_phones text[])":
    {
      roles: ["authenticated"],
      args: {
        start_kind: "'walk_in'",
        existing_contact_id: "'c0c0c0c0-0000-4000-8000-000000000431'",
        new_contact: "null",
        student_details:
          '\'{"full_name": "Sample Pupil", "class_name": "STD 2", "enrollment_year": 2027, "day_or_boarding": "Day"}\'::jsonb',
        visited_on: "current_date",
        also_check_phones: "array[]::text[]",
      },
      agent: { refused: "not_permitted" },
    },
  "public.create_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)": {
    roles: ["authenticated"],
    args: {
      full_name: "'Sample Person'",
      phone: "'0700000101'",
      whatsapp: "null",
      email: "'sample@example.test'",
      code: "'BJN-402'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.create_role(name text)": {
    roles: ["authenticated"],
    args: { name: "'Sample role'" },
    agent: { refused: "not_permitted" },
  },
  // The signed-in agent's own name, code and state (#191): their own record,
  // never another agent's or any staff data. Staff and visitors get no row.
  "public.current_agent_account()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [{ state: "active", full_name: "Saida Amina Mtei", code: "SAM-403" }] },
  },
  "public.current_staff_member()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [] },
  },
  "public.dashboard_count(metric text, period_kind text, anchor date, enrollment_year integer)": {
    roles: ["authenticated"],
    args: {
      metric: "'visited_leads'",
      period_kind: "'month'",
      anchor: "date '2026-11-05'",
      enrollment_year: "2027",
    },
    agent: { refused: "forbidden" },
  },
  "public.dashboard_enrollment_years()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "forbidden" },
  },
  "public.dashboard_leads_by_class(period_kind text, anchor date, enrollment_year integer)": {
    roles: ["authenticated"],
    args: {
      period_kind: "'month'",
      anchor: "date '2026-11-05'",
      enrollment_year: "2027",
    },
    agent: { refused: "forbidden" },
  },
  "public.dashboard_period_bounds(period_kind text, anchor date, OUT starts date, OUT ends date)": {
    roles: ["authenticated"],
    args: { period_kind: "'month'", anchor: "date '2026-11-05'" },
    agent: { returns: [{ ends: "2026-12-01", starts: "2026-11-01" }] },
  },
  "public.deactivate_staff_member(staff_id uuid)": {
    roles: ["authenticated"],
    args: { staff_id: "'a1a1a1a1-0000-4000-8000-000000000003'" },
    agent: { refused: "not_permitted" },
  },
  // Confirm or Reject an email claim (#193).
  "public.decide_agent_email_claim(claim_id uuid, decision text, email text)": {
    roles: ["authenticated"],
    setup:
      "insert into public.agent_email_claims (id, agent_id, outcome, full_name, email) values ('c1a10000-0000-4000-8000-000000000193', 'a4a4a4a4-0000-4000-8000-000000000002', 'pending', 'Surface Claim', 'surface-claim@example.test')",
    args: { claim_id: "'c1a10000-0000-4000-8000-000000000193'", decision: "'reject'", email: "null" },
    agent: { refused: "not_permitted" },
  },
  "public.decide_discount(request_id uuid, decision text, reason text)": {
    roles: ["authenticated"],
    args: {
      request_id: "'d15c0000-0000-4000-8000-000000000907'",
      decision: "'refuse'",
      reason: "'A sample reason'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.decline_lead(lead_id uuid, reason text, explanation text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      reason: "'Family changed plans'",
      explanation: "'The family moved away'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.dismiss_notices(through bigint)": {
    roles: ["authenticated"],
    setup:
      // The sample caller is the Super Admin, whose record is frozen (#237),
      // so the notice is made with the freeze lifted by name.
      "select public.set_audit_actor('staff', 'a1a1a1a1-0000-4000-8000-000000000002'); alter table public.staff_members disable trigger refuse_super_admin_holder_change; update public.staff_members set active = false where id = '5a000000-0000-4000-8000-000000000002'; update public.staff_members set active = true where id = '5a000000-0000-4000-8000-000000000002'; alter table public.staff_members enable trigger refuse_super_admin_holder_change",
    args: {
      through: "(select max(a.id) from public.audit_log a where public.is_notice_for(a, '5a000000-0000-4000-8000-000000000002'))",
    },
    agent: { refused: "not_staff" },
  },
  "public.expected_interview_amount(lead_id uuid, OUT amount integer, OUT discount_applied boolean)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.family_children(family_contact_id uuid)": {
    roles: ["authenticated"],
    args: { family_contact_id: "'c0c0c0c0-0000-4000-8000-000000000431'" },
    agent: { returns: [[]] },
  },
  "public.fee_band_of(class_name lead_class)": {
    roles: ["authenticated"],
    args: { class_name: "'STD 2'" },
    agent: { returns: ["primary_lower"] },
  },
  // Finishes a batch the full-permission sample staff member started.
  "public.finish_agent_invite_batch(batch_id uuid, stop_reason text)": {
    roles: ["authenticated"],
    setup:
      "insert into public.agent_invite_batches (id, started_by, daily_cap, staff_reserve, batch_limit, used_today, waiting, skipped_recent) values ('b7b7b7b7-0000-4000-8000-000000000192', '5a000000-0000-4000-8000-000000000002', 100, 20, 30, 0, 0, 0)",
    args: { batch_id: "'b7b7b7b7-0000-4000-8000-000000000192'", stop_reason: "'done'" },
    agent: { refused: "not_permitted" },
  },
  "public.find_family_by_phone(phone text, whatsapp text)": {
    roles: ["authenticated"],
    args: { phone: "'0700000101'", whatsapp: "null" },
    agent: { refused: "not_permitted" },
  },
  "public.find_marketing_agent(typed_code text)": {
    roles: ["authenticated"],
    args: { typed_code: "'BJN-402'" },
    agent: { returns: [] },
  },
  "public.follow_up_date_needed()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [] },
  },
  "public.follow_up_overdue_count()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [0] },
  },
  "public.follow_up_queue(section text, page integer)": {
    roles: ["authenticated"],
    args: { section: "'overdue'", page: "1" },
    agent: { returns: [] },
  },
  "public.follow_up_queue_items(section text)": {
    roles: ["authenticated"],
    args: { section: "'overdue'" },
    agent: { returns: [] },
  },
  "public.follow_up_record_staff(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { returns: [] },
  },
  "public.group_invitation_family_count(link_year integer)": {
    roles: ["authenticated"],
    args: { link_year: "2027" },
    agent: { refused: "forbidden" },
  },
  "public.group_links()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.has_permission(permission text)": {
    roles: ["authenticated"],
    args: { permission: "'leads.view'" },
    agent: { returns: [false] },
  },
  "public.import_batch_importers(batch_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      batch_ids: "array(select id from public.import_batches order by id limit 1)",
    },
    agent: { refused: "not_permitted" },
  },
  "public.interview_discount()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [10000] },
  },
  "public.interview_registration_open(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.interview_release_status(interview_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      interview_ids: "array['1e7e0000-0000-4000-8000-000000000501']::uuid[]",
    },
    agent: { refused: "forbidden" },
  },
  "public.interview_years()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [] },
  },
  "public.invite_staff_member(full_name text, email text, role_id uuid)": {
    roles: ["authenticated"],
    args: {
      full_name: "'Sample Person'",
      email: "'sample@example.test'",
      role_id: "(select id from public.roles where name = 'Admissions Staff')",
    },
    agent: { refused: "not_permitted" },
  },
  "public.invited_staff_members()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [] },
  },
  "public.is_active_staff()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [false] },
  },
  "public.lead_closure(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.lead_count(agent marketing_agents)": {
    roles: ["authenticated"],
    args: {
      agent: "(select a from public.marketing_agents a where a.id = 'a4a4a4a4-0000-4000-8000-000000000002')",
    },
    agent: { returns: [0] },
  },
  "public.lead_discount_requests(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.lead_family(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.lead_group_invitation(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  // audit.view alone (#237).
  "public.lead_history(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  // When the lead's status last changed (#237): leads.view.
  "public.lead_status_since(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.lead_is_closed(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.lead_reopening_requests(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.lead_school_fee(lead_id uuid, OUT enrollment_year integer, OUT band fee_band, OUT day_or_boarding day_or_boarding, OUT has_schedule boolean, OUT school_fee integer, OUT total_paid bigint, OUT balance bigint, OUT first_amount integer, OUT first_due date, OUT second_amount integer, OUT second_due date, OUT third_amount integer, OUT third_due date, OUT priority seat_priority, OUT priority_reached_on date, OUT enrolled_trigger text, OUT enrolled_on date, OUT enrolled_payment_type school_fee_payment_type, OUT enrolled_payment_amount integer, OUT band_fee integer, OUT discount text, OUT discount_percent integer, OUT pre_form_one boolean, OUT pre_form_one_offered boolean, OUT pre_form_one_applies boolean, OUT pre_form_one_fee integer, OUT pre_form_one_paid bigint, OUT pre_form_one_balance bigint)":
    {
      roles: ["authenticated"],
      args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
      agent: { refused: "forbidden" },
    },
  "public.lead_school_fee_payments(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.lead_seat_priorities(lead_ids uuid[])": {
    roles: ["authenticated"],
    args: { lead_ids: "array['1ead0000-0000-4000-8000-000000000431']::uuid[]" },
    agent: { refused: "forbidden" },
  },
  "public.leads_with_earlier_group_link(link_year integer)": {
    roles: ["authenticated"],
    args: { link_year: "2027" },
    agent: { returns: [] },
  },
  "public.list_contact_staff()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.mark_lead(lead_id uuid, mark text, reason text, note text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      mark: "'Inactive'",
      reason: "'Family requested closure'",
      note: "'A note'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.mark_re_application_reviewed(re_application_id uuid)": {
    roles: ["authenticated"],
    args: {
      re_application_id: "(select id from public.re_applications where reviewed_at is null order by id limit 1)",
    },
    agent: { refused: "not_permitted" },
  },
  "public.marketing_agent_approvers(agent_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      agent_ids: "array['a4a4a4a4-0000-4000-8000-000000000002']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.marketing_agent_status_notes(agent_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      agent_ids: "array['a4a4a4a4-0000-4000-8000-000000000002']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.my_notices()": {
    roles: ["authenticated"],
    args: {},
    agent: { returns: [] },
  },
  "public.normalize_phone(phone text)": {
    roles: ["authenticated"],
    args: { phone: "'0700000101'" },
    agent: { returns: ["+255700000101"] },
  },
  "public.normalize_referral_code(code text)": {
    roles: ["authenticated"],
    args: { code: "'BJN-402'" },
    agent: { returns: ["BJN-402"] },
  },
  "public.normalize_student_name(name text)": {
    roles: ["authenticated"],
    args: { name: "'Sample role'" },
    agent: { returns: ["sample role"] },
  },
  "public.pending_discount_requests()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.pending_reopening_request_count()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.pending_reopening_requests()": {
    roles: ["authenticated"],
    args: {},
    agent: { refused: "not_permitted" },
  },
  "public.preview_school_fee_payment(lead_id uuid, payment_type text, amount numeric, paid_on date)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000902'",
      payment_type: "'first_instalment'",
      amount: "100000",
      paid_on: "current_date",
    },
    agent: { refused: "not_permitted" },
  },
  "public.raise_reopening_request(lead_id uuid, reason text, source text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000006'",
      reason: "'A sample reason'",
      source: "'lead'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.re_application_reviewers(re_application_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      re_application_ids: "array(select id from public.re_applications order by id limit 1)",
    },
    agent: { refused: "not_permitted" },
  },
  "public.reactivate_staff_member(staff_id uuid)": {
    roles: ["authenticated"],
    args: { staff_id: "'a1a1a1a1-0000-4000-8000-000000000005'" },
    agent: { refused: "not_permitted" },
  },
  "public.prepare_agent_invite(agent_id uuid, expected_email text, batch_id uuid)": {
    roles: ["authenticated"],
    setup: "update public.marketing_agents set email = 'surface-invite@example.test' where id = 'a4a4a4a4-0000-4000-8000-000000000002'",
    args: {
      agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'",
      expected_email: "'surface-invite@example.test'",
      batch_id: "null",
    },
    agent: { refused: "not_permitted" },
  },
  "public.record_action(kind text, lead_id uuid, details jsonb)": {
    roles: ["authenticated"],
    args: {
      kind: "'invite_sent'",
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      details: "'{}'::jsonb",
    },
    agent: { refused: "not_permitted" },
  },
  // The result of an invite attempt the Manager started.
  "public.record_agent_invite(attempt_id uuid, result text, error_code text)": {
    roles: ["authenticated"],
    setup:
      "insert into public.agent_events (id, agent_id, kind, result, email, created_by) values ('e7e7e7e7-0000-4000-8000-000000000192', 'a4a4a4a4-0000-4000-8000-000000000002', 'invite', 'started', 'surface-invite@example.test', '5a000000-0000-4000-8000-000000000002')",
    args: { attempt_id: "'e7e7e7e7-0000-4000-8000-000000000192'", result: "'sent'", error_code: "null" },
    agent: { refused: "not_permitted" },
  },
  "public.record_follow_up(lead_id uuid, follow_up_id uuid, comment text, method text, contacted_by uuid, contacted_at timestamp with time zone, outcome text, next_due_on date, next_note text, decline_reason text, decline_note text)":
    {
      roles: ["authenticated"],
      args: {
        lead_id: "'1ead0000-0000-4000-8000-000000000002'",
        follow_up_id: "'f0110000-0000-4000-8000-000000000002'",
        comment: "'Called the family'",
        method: "'Phone call'",
        contacted_by: "'a1a1a1a1-0000-4000-8000-000000000003'",
        contacted_at: "now()",
        outcome: "'next_date'",
        next_due_on: "current_date + 7",
        next_note: "null",
        decline_reason: "null",
        decline_note: "null",
      },
      agent: { refused: "not_permitted" },
    },
  "public.record_interview_result(interview_id uuid, interviewed_on date, outcome text, score numeric)": {
    roles: ["authenticated"],
    args: {
      interview_id: "'1e7e0000-0000-4000-8000-000000000501'",
      interviewed_on: "current_date",
      outcome: "'Passed'",
      score: "75",
    },
    agent: { refused: "not_permitted" },
  },
  "public.record_school_fee_payment(lead_id uuid, payment_type text, amount numeric, paid_on date, request_id uuid)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000902'",
      payment_type: "'first_instalment'",
      amount: "100000",
      paid_on: "current_date",
      request_id: "'00000000-0000-4000-8000-000000000188'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.record_visit(lead_id uuid, visited_on date)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      visited_on: "current_date",
    },
    agent: { refused: "not_permitted" },
  },
  "public.recreate_marketing_agent(agent_id uuid, full_name text, phone text, whatsapp text, email text, reason text)": {
    roles: ["authenticated"],
    args: {
      agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'",
      full_name: "'Sample Person'",
      phone: "'0700000101'",
      whatsapp: "null",
      email: "'sample@example.test'",
      reason: "'A sample reason'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.register_for_interview(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "not_permitted" },
  },
  "public.reject_family_match(lead_id uuid, expected_lead_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000049'",
      expected_lead_ids: "array['1ead0000-0000-4000-8000-000000000049', '1ead0000-0000-4000-8000-000000000050']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.reject_reopening_request(request_id uuid, reason text)": {
    roles: ["authenticated"],
    args: {
      request_id: "'5e0e0000-0000-4000-8000-000000000911'",
      reason: "'A sample reason'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.release_result(interview_id uuid, channel text)": {
    roles: ["authenticated"],
    args: {
      interview_id: "'1e7e0000-0000-4000-8000-000000000601'",
      channel: "'whatsapp'",
    },
    agent: { refused: "forbidden" },
  },
  "public.rename_role(role_id uuid, name text)": {
    roles: ["authenticated"],
    args: {
      role_id: "(select id from public.roles where name = 'Admissions Staff')",
      name: "'Sample role'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.request_discount(lead_id uuid, kind text, note text, request_id uuid)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      kind: "'staff_child'",
      note: "'A note'",
      request_id: "'00000000-0000-4000-8000-000000000188'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.resendable_invite(staff_id uuid)": {
    roles: ["authenticated"],
    args: { staff_id: "'a1a1a1a1-0000-4000-8000-000000000007'" },
    agent: { refused: "not_permitted" },
  },
  "public.result_ready_to_send(interviews)": {
    roles: ["authenticated"],
    args: {
      $1: "(select i from public.interviews i where i.id = '1e7e0000-0000-4000-8000-000000000501')",
    },
    agent: { refused: "forbidden" },
  },
  "public.result_release_state(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.result_releases(interview_id uuid)": {
    roles: ["authenticated"],
    args: { interview_id: "'1e7e0000-0000-4000-8000-000000000501'" },
    agent: { refused: "forbidden" },
  },
  "public.retire_role(role_id uuid)": {
    roles: ["authenticated"],
    setup: "insert into public.roles (id, name) values ('b0b0b0b0-0000-4000-8000-000000000188', 'Sample role')",
    args: {
      role_id: "'b0b0b0b0-0000-4000-8000-000000000188'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.save_fee_schedule(schedule_year integer, amounts jsonb)": {
    roles: ["authenticated"],
    args: {
      schedule_year: "2027",
      amounts:
        '\'{"bands": {"nursery": {"day_fee": 1100000, "boarding_fee": 3000000}, "primary_lower": {"day_fee": 2000000, "boarding_fee": 3000000}, "primary_upper": {"day_fee": 2100000, "boarding_fee": 3300000}, "secondary": {"day_fee": 2800000, "boarding_fee": 4300000}}, "first_share": 40, "second_share": 40, "third_share": 20, "first_due": "2026-11-01", "second_due": "2027-04-01", "third_due": "2027-06-01", "minimum_deposit": 300000, "pre_form_one_day_fee": 450000, "pre_form_one_boarding_fee": 580000}\'::jsonb',
    },
    agent: { refused: "not_permitted" },
  },
  "public.schedule_follow_up(lead_id uuid, due_on date, note text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      due_on: "current_date + 7",
      note: "'A note'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.seat_check(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000431'" },
    agent: { refused: "forbidden" },
  },
  "public.send_group_invitation(lead_id uuid, method text, link_year integer, link_seen text, template_version text)": {
    roles: ["authenticated"],
    setup:
      "insert into public.whatsapp_group_links (enrollment_year, url, set_by) values (2027, 'https://chat.whatsapp.com/Sample188', 'a1a1a1a1-0000-4000-8000-000000000001')",
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000002'",
      method: "'link'",
      link_year: "2027",
      link_seen: "'https://chat.whatsapp.com/Sample188'",
      template_version: "'group_invitation_v1'",
    },
    agent: { refused: "forbidden" },
  },
  "public.separate_from_family(lead_id uuid)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000002'" },
    agent: { refused: "not_permitted" },
  },
  "public.set_academic_year(schedule_year integer, settings jsonb)": {
    roles: ["authenticated"],
    args: { schedule_year: "2027", settings: "'{}'::jsonb" },
    agent: { refused: "not_permitted" },
  },
  "public.set_group_link(link_year integer, link text, link_was text)": {
    roles: ["authenticated"],
    args: {
      link_year: "2027",
      link: "'https://chat.whatsapp.com/AbCdEf1234567890'",
      link_was: "null",
    },
    agent: { refused: "not_permitted" },
  },
  "public.set_interview_fee_status(interview_id uuid, fee_status text)": {
    roles: ["authenticated"],
    args: {
      interview_id: "'1e7e0000-0000-4000-8000-000000000501'",
      fee_status: "'Paid'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.set_lead_referral_code(lead_id uuid, code text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      code: "'SAM-403'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.set_marketing_agent_email(agent_id uuid, email text)": {
    roles: ["authenticated"],
    args: { agent_id: "'a4a4a4a4-0000-4000-8000-000000000002'", email: "'surface-email@example.test'" },
    agent: { refused: "not_permitted" },
  },
  "public.set_pre_form_one(lead_id uuid, ticked boolean)": {
    roles: ["authenticated"],
    args: { lead_id: "'1ead0000-0000-4000-8000-000000000004'", ticked: "true" },
    agent: { refused: "not_permitted" },
  },
  "public.set_prior_sibling(lead_id uuid, sibling_name text, sibling_class text)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      sibling_name: "'Sample Sibling'",
      sibling_class: "'STD 3'",
    },
    agent: { refused: "not_permitted" },
  },
  "public.set_role_permission(role_id uuid, permission text, granted boolean)": {
    roles: ["authenticated"],
    args: {
      role_id: "(select id from public.roles where name = 'Admissions Staff')",
      permission: "'leads.view'",
      granted: "true",
    },
    agent: { refused: "not_permitted" },
  },
  "public.start_agent_invite_batch(import_batch_id uuid, daily_cap integer, staff_reserve integer, batch_limit integer)": {
    roles: ["authenticated"],
    args: { import_batch_id: "null", daily_cap: "100", staff_reserve: "20", batch_limit: "1" },
    agent: { refused: "not_permitted" },
  },
  "public.tanzania_today()": {
    roles: ["authenticated"],
    args: {},
    agent: { anyAnswer: "Today's date in Tanzania, the same for everyone." },
  },
  "public.update_guardian_contact(contact_id uuid, changes jsonb, expected_lead_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      contact_id: "'c0c0c0c0-0000-4000-8000-000000000431'",
      changes: '\'{"student_name": "Asha Referral"}\'::jsonb',
      expected_lead_ids: "array['1ead0000-0000-4000-8000-000000000431']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.update_guardian_contact_for_lead(lead_id uuid, contact_id uuid, changes jsonb, expected_lead_ids uuid[])": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      contact_id: "'c0c0c0c0-0000-4000-8000-000000000431'",
      changes: '\'{"student_name": "Asha Referral"}\'::jsonb',
      expected_lead_ids: "array['1ead0000-0000-4000-8000-000000000431']::uuid[]",
    },
    agent: { refused: "not_permitted" },
  },
  "public.update_lead_details(lead_id uuid, changes jsonb)": {
    roles: ["authenticated"],
    args: {
      lead_id: "'1ead0000-0000-4000-8000-000000000431'",
      changes: '\'{"student_name": "Asha Referral"}\'::jsonb',
    },
    agent: { refused: "not_permitted" },
  },
  "public.withdraw_reopening_request(request_id uuid)": {
    roles: ["authenticated"],
    setup:
      "insert into public.reopening_requests (id, lead_id, source, reason, requested_by) values ('5e0e0000-0000-4000-8000-000000000188', '1ead0000-0000-4000-8000-000000000905', 'lead', 'A sample reason', '5a000000-0000-4000-8000-000000000002')",
    args: { request_id: "'5e0e0000-0000-4000-8000-000000000188'" },
    agent: { refused: "not_permitted" },
  },
  "public.year_seats(schedule_year integer)": {
    roles: ["authenticated"],
    args: { schedule_year: "2027" },
    agent: { refused: "forbidden" },
  },
}

export const RELATIONS: Record<string, RelationEntry> = {
  "public.admission_submissions": { authenticated: [], anon: [] },
  "public.agent_access_settings": { authenticated: [], anon: [] },
  "public.agent_detached_logins": { authenticated: [], anon: [] },
  "public.agent_email_claims": { authenticated: [], anon: [] },
  "public.agent_events": { authenticated: [], anon: [] },
  "public.agent_invite_batches": { authenticated: [], anon: [] },
  "public.agent_link_requests": { authenticated: [], anon: [] },
  "public.agent_status_changes": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.audit_action_kinds": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.audit_log": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.audit_scopes": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.class_seats": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.discount_requests": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.fee_band_amounts": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.fee_schedules": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.follow_up_records": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.follow_ups": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.guardian_contacts": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.import_batches": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.interview_serial_counters": { authenticated: [], anon: [] },
  "public.interviews": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.lead_fee_profiles": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.leads": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.marketing_agents": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.payment_adjustments": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.permissions": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.re_applications": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.reopening_requests": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.roles": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.school_fee_payments": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.staff_members": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.whatsapp_group_invitations": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
  "public.whatsapp_group_links": {
    authenticated: ["select", "references", "trigger", "maintain"],
    anon: ["select", "references", "trigger", "maintain"],
  },
}

export const POLICIES: Record<string, PolicyEntry> = {
  "public.agent_status_changes: Staff who may view leads read agent status changes": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.audit_action_kinds: Active staff read the action kinds": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT is_active_staff() AS is_active_staff)",
    check: null,
  },
  // The audit history is the Super Admin's alone (#237).
  "public.audit_log: Only the Super Admin reads the audit history": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('audit.view'::text) AS has_permission)",
    check: null,
  },
  "public.audit_scopes: Active staff read the audit scopes": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT is_active_staff() AS is_active_staff)",
    check: null,
  },
  "public.class_seats: Staff who may view payments read class seats": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('payments.view'::text) AS has_permission)",
    check: null,
  },
  "public.discount_requests: Staff who may view leads read discount requests": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.fee_band_amounts: Staff who may view payments read fee band amounts": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('payments.view'::text) AS has_permission)",
    check: null,
  },
  "public.fee_schedules: Staff who may view payments read fee schedules": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('payments.view'::text) AS has_permission)",
    check: null,
  },
  "public.follow_up_records: Staff who may view leads read follow-up records": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.follow_ups: Staff who may view leads read follow-ups": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.guardian_contacts: Staff who may view leads read contacts": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.import_batches: Staff who may view leads read agent imports": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "((kind = 'agents'::text) AND ( SELECT has_permission('leads.view'::text) AS has_permission))",
    check: null,
  },
  "public.interviews: Staff who may view leads read interviews": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.lead_fee_profiles: Staff who may view leads read lead fee profiles": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.leads: Staff who may view leads read leads": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.marketing_agents: Staff who may view leads read marketing agents": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.payment_adjustments: Staff who may view payments read payment adjustments": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('payments.view'::text) AS has_permission)",
    check: null,
  },
  // audit.view only for the Super Admin, who alone holds it (#237).
  "public.permissions: Active staff read the permission list, audit.view aside": {
    command: "SELECT",
    roles: ["authenticated"],
    using:
      "(( SELECT is_active_staff() AS is_active_staff) AND ((name <> 'audit.view'::text) OR ( SELECT has_permission('audit.view'::text) AS has_permission)))",
    check: null,
  },
  "public.re_applications: Staff who may view leads read re-applications": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.reopening_requests: Staff who may view leads read reopening requests": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  // The Super Admin role is never returned, to anyone (#237).
  "public.roles: Active staff read roles, never the Super Admin role": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "(( SELECT is_active_staff() AS is_active_staff) AND (id <> '5a000000-0000-4000-8000-000000000001'::uuid))",
    check: null,
  },
  "public.school_fee_payments: Staff who may view payments read school-fee payments": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('payments.view'::text) AS has_permission)",
    check: null,
  },
  // Administrators never read the Super Admin's record; the holder reads their own (#237).
  "public.staff_members: Own record; administrators read all but the Super Admin": {
    command: "SELECT",
    roles: ["authenticated"],
    using:
      "(((user_id = ( SELECT auth.uid() AS uid)) AND active) OR (( SELECT has_permission('staff.administer'::text) AS has_permission) AND (role_id <> '5a000000-0000-4000-8000-000000000001'::uuid)))",
    check: null,
  },
  "public.whatsapp_group_invitations: Staff who view leads read group invitations": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
  "public.whatsapp_group_links: Staff who view leads read group links": {
    command: "SELECT",
    roles: ["authenticated"],
    using: "( SELECT has_permission('leads.view'::text) AS has_permission)",
    check: null,
  },
}
