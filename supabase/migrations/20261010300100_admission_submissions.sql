-- The Admission form's submissions (slice 3). A parent's phone may drop the
-- connection after the school has created a child's lead but before the
-- confirmation arrives, and the parent taps Send again. The form keeps one
-- random submission key until it shows a confirmation, and this table keeps,
-- per key, a hash of what was sent and each child's outcome as it is reached.
-- A repeat with the same key and payload gets the stored outcomes back and
-- creates nothing. The same key with a different payload, once a child has
-- been created under it, gets those children back as `submission_key_reused`:
-- the parent's earlier send went through, and the edits are not saved. Before
-- any child is created, the key simply moves to the new payload.
--
-- Nobody reads or writes the table through the API, the secret key included:
-- the one way in is submit_admission_form_child, which only the secret key
-- may call. It holds a hash, lead ids and Admission Numbers, nothing the
-- parent typed, so it is not audited; the leads it creates are, through
-- create_lead.

create table public.admission_submissions (
    submission_key uuid primary key,
    -- SHA-256, hex, of the normalized payload the form sent (the service
    -- computes it, so the hash covers exactly what it validated).
    payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
    -- The contact the form's first created child made. Later children on the
    -- same form are created on it, so siblings share one parent contact.
    contact_id uuid references public.guardian_contacts (id),
    -- Each child's outcome, by its position on the form ("0", "1", ...).
    outcomes jsonb not null default '{}'::jsonb check (jsonb_typeof(outcomes) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index admission_submissions_contact_id_idx on public.admission_submissions (contact_id);

alter table public.admission_submissions enable row level security;

-- No policies: no role reads or writes a row through the API.
revoke all on table public.admission_submissions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- submit_admission_form_child: handles one child of one Admission form, in
-- one transaction, so a child's lead and its stored outcome are written
-- together or not at all. The service calls it once per child, in form order.
--
--   - Serialized per submission key, so two sends of the same form at once
--     are handled one after the other, and the second reads the first's
--     outcome.
--   - A key already used with a different payload: if a child was created
--     under it, `submission_key_reused`, with the created children (name and
--     Admission Number, in form order) as the detail, and nothing is written.
--     If none was, the key takes the new payload.
--   - A child already handled under this key: its stored outcome, with
--     `replayed` true. Nothing is written.
--   - Otherwise the child is created through slice 2's create_lead with the
--     Admission form start, on the submission's contact once one exists, and
--     its outcome is stored. create_lead's own refusals (`invalid` with the
--     field, `not_permitted`) are raised unchanged, and roll back this call,
--     the submission row included.
--   - A child already on file comes back as create_lead's `duplicate`, and
--     nothing is stored: until the Re-application ticket (#76) records it,
--     the service treats it as unavailable.
-- ---------------------------------------------------------------------------

create function public.submit_admission_form_child(
    submission_key uuid,
    payload_hash text,
    child_index integer,
    new_contact jsonb,
    student_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    submission public.admission_submissions;
    stored jsonb;
    created jsonb;
    created_contact uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if submit_admission_form_child.submission_key is null
       or submit_admission_form_child.payload_hash is null
       or submit_admission_form_child.payload_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'submission_key')::text;
    end if;
    if child_index is null or child_index not between 0 and 7 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'children')::text;
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended('admission-submission:' || submit_admission_form_child.submission_key::text, 0)
    );

    insert into public.admission_submissions (submission_key, payload_hash)
    values (submit_admission_form_child.submission_key, submit_admission_form_child.payload_hash)
    on conflict on constraint admission_submissions_pkey do nothing;

    select * into submission
    from public.admission_submissions s
    where s.submission_key = submit_admission_form_child.submission_key;

    if submission.payload_hash <> submit_admission_form_child.payload_hash then
        if submission.outcomes = '{}'::jsonb then
            update public.admission_submissions s
            set payload_hash = submit_admission_form_child.payload_hash,
                updated_at = now()
            where s.submission_key = submit_admission_form_child.submission_key;
        else
            raise exception 'submission_key_reused' using detail = (
                select jsonb_agg(
                    jsonb_build_object('full_name', o.value ->> 'full_name', 'admission_number', o.value ->> 'admission_number')
                    order by o.key::integer
                )
                from jsonb_each(submission.outcomes) o
            )::text;
        end if;
    end if;

    stored := submission.outcomes -> child_index::text;
    if stored is not null then
        return stored || jsonb_build_object('replayed', true);
    end if;

    -- create_lead sets the Admission form as the actor itself.
    created := public.create_lead(
        'admission_form',
        submission.contact_id,
        case when submission.contact_id is null then new_contact end,
        student_details
    );

    if created ->> 'result' <> 'created' then
        return created;
    end if;

    if submission.contact_id is null then
        select l.guardian_contact_id into created_contact
        from public.leads l
        where l.id = (created ->> 'lead_id')::uuid;
    end if;

    update public.admission_submissions s
    set outcomes = s.outcomes || jsonb_build_object(
            child_index::text,
            created || jsonb_build_object('full_name', student_details ->> 'full_name')
        ),
        contact_id = coalesce(s.contact_id, created_contact),
        updated_at = now()
    where s.submission_key = submit_admission_form_child.submission_key;

    return created || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.submit_admission_form_child(uuid, text, integer, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.submit_admission_form_child(uuid, text, integer, jsonb, jsonb) to service_role;
