-- A repeated, harmless sibling answer is accepted (#378, #367 second case;
-- spec #296). Both are in save_sibling_choice, which register_students
-- (#304) and complete_admission_visit (#305) share. Fees, discounts,
-- statuses and seat counts do not move on migration day.
--
-- 1. A pending Sibling request is kept (#378). A lead linked before, that
--    waits on a Sibling request about the group it is in, sent the same
--    "Sibling of" again (a check-in that re-sends it), used to get the
--    request-note question and then `already_pending`, refusing the whole
--    save. Now the existing request is returned and nothing is asked. A note
--    sent with it is not a second request.
-- 2. A typo answer's old spelling is accepted later in the same save (#367,
--    option B). Two students on one form link to the same on-file sibling
--    and both answer its father's name with the spelling they saw. The
--    first student's typing-mistake answer writes the right spelling onto
--    the sibling, so the second student's answer used to be refused as
--    `invalid` `sibling_father_full_name`, the same payload every time.
--    write_typo_spelling now records each lead and the spelling it replaced
--    in app.sibling_typo_replaced (transaction-local), and
--    save_sibling_choice drops a sibling's father's-name answer that is that
--    replaced spelling for that sibling, as it already drops one that
--    matches the stored name. A different name is still refused.
--
-- Nothing else changes. One `do` block, with the fee snapshot check;
-- every function is `create or replace`.
--
-- Rollback: a new migration putting back save_sibling_choice from
-- 20261216100100 and write_typo_spelling from 20261213100100.

do $migration$
begin
    perform public.set_audit_actor('system');

    drop table if exists pg_temp.repeated_answers_snapshot_before;
    create temp table repeated_answers_snapshot_before as select * from public.fee_snapshot();

    -- write_typo_spelling, as 20261213100100 made it, now recording what
    -- it replaced for the rest of the transaction. Same signature.
    create or replace function public.write_typo_spelling(group_id uuid, spelling text, replaced text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        earlier_override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        each_lead uuid;
    begin
        perform set_config('app.sibling_typo_group', write_typo_spelling.group_id::text, true);
        perform set_config('app.lead_lifecycle_override', 'father_name_typo', true);
        for each_lead in
            select l.id
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            where m.group_id = write_typo_spelling.group_id
              and public.normalize_father_name(l.father_full_name) = public.normalize_father_name(write_typo_spelling.replaced)
            order by l.id
            for update of l
        loop
            update public.leads l
            set father_full_name = write_typo_spelling.spelling,
                father_full_name_source = 'typo_confirmed'
            where l.id = each_lead;
            -- Kept for the rest of this transaction: a later answer in the
            -- same save that still gives the replaced spelling for this
            -- lead is no new answer (save_sibling_choice, #367).
            perform set_config(
                'app.sibling_typo_replaced',
                concat_ws(';', nullif(current_setting('app.sibling_typo_replaced', true), ''),
                          each_lead::text || ':' || public.normalize_father_name(write_typo_spelling.replaced)),
                true
            );
        end loop;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
        perform set_config('app.sibling_typo_group', '', true);
    end;
    $fn$;

    revoke execute on function public.write_typo_spelling(uuid, text, text) from public, anon, authenticated, service_role;

    -- save_sibling_choice, as 20261216100100 made it, now keeping a pending
    -- Sibling request about the lead's group and dropping a replaced
    -- spelling. Same signature and answers.
    create or replace function public.save_sibling_choice(
        lead_id uuid,
        sibling_of_lead_id uuid,
        choice jsonb,
        student integer
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        linked jsonb;
        question jsonb;
        note text;
        new_request uuid;
        given_request uuid;
        member public.sibling_group_members;
        earlier public.discount_requests;
        staff_id uuid;
        failed_message text;
        failed_state text;
        failed_detail text;
        failed_hint text;
        detail_json jsonb;
        sibling_name text := save_sibling_choice.choice ->> 'sibling_father_full_name';
        target public.leads;
        target_member public.sibling_group_members;
        replaced text := coalesce(current_setting('app.sibling_typo_replaced', true), '');
        pending public.discount_requests;
    begin
        begin
            -- Two students linked to one on-file sibling both answer its
            -- father's name. The first link confirms it; the same name again
            -- is no new answer, and is dropped rather than refused. So is
            -- the spelling a typing-mistake answer earlier in this save
            -- replaced on that sibling (#367): staff typed what they saw, and
            -- the outcome does not depend on which student is linked first.
            if sibling_name is not null then
                select * into target from public.leads l where l.id = save_sibling_choice.sibling_of_lead_id;
                select * into target_member from public.sibling_group_members m where m.lead_id = save_sibling_choice.sibling_of_lead_id;
                if not ((target_member.group_id is not null and target_member.legacy)
                        or (target_member.group_id is null
                            and (target.father_full_name is null or target.father_full_name_source = 'backfilled')))
                   and (public.father_name_match(sibling_name, target.father_full_name) = 'same'
                        or (target.id::text || ':' || public.normalize_father_name(sibling_name))
                           = any (string_to_array(replaced, ';'))) then
                    sibling_name := null;
                end if;
            end if;

            linked := public.link_sibling_locked(
                save_sibling_choice.lead_id,
                save_sibling_choice.sibling_of_lead_id,
                save_sibling_choice.choice ->> 'father_full_name',
                sibling_name,
                save_sibling_choice.choice -> 'name_answer' ->> 'answer',
                save_sibling_choice.choice -> 'name_answer' ->> 'spelling',
                true
            );

            question := case linked ->> 'result'
                when 'name_question' then jsonb_build_object(
                    'question', 'name',
                    'father_full_name', linked ->> 'father_full_name',
                    'sibling_lead_id', linked ->> 'sibling_lead_id',
                    'sibling_father_full_name', linked ->> 'sibling_father_full_name'
                )
                when 'sibling_father_name_needed' then jsonb_build_object(
                    'question', 'sibling_father_name', 'sibling_lead_id', linked ->> 'lead_id'
                )
                when 'father_name_needed' then jsonb_build_object('question', 'father_name', 'lead_id', linked ->> 'lead_id')
            end;

            -- A lead that already waits on a Sibling request about this
            -- group keeps it: the same choice sent again (a check-in of a
            -- child linked before, #378) asks nothing and raises no second
            -- request.
            if question is null and linked ->> 'basis' in ('request_needed', 'refused') then
                select r.* into pending
                from public.discount_requests r
                where r.lead_id = save_sibling_choice.lead_id and r.kind = 'sibling' and r.state = 'pending'
                  and r.group_id = (linked ->> 'group_id')::uuid
                  and r.merge_from_group_id is null
                limit 1;
                new_request := pending.id;
            end if;

            if question is null and new_request is null and linked ->> 'basis' in ('request_needed', 'refused') then
                note := btrim(coalesce(save_sibling_choice.choice ->> 'request_note', ''));
                if note = '' and linked ->> 'basis' = 'request_needed' then
                    question := jsonb_build_object(
                        'question', 'request_note', 'sibling_lead_id', save_sibling_choice.sibling_of_lead_id
                    );
                elsif note <> '' then
                    if char_length(note) > 1000 then
                        raise exception 'invalid' using detail = jsonb_build_object('field', 'request_note')::text;
                    end if;
                    begin
                        given_request := coalesce((save_sibling_choice.choice ->> 'request_id')::uuid, gen_random_uuid());
                    exception when invalid_text_representation then
                        raise exception 'invalid' using detail = jsonb_build_object('field', 'request_id')::text;
                    end;
                    select * into earlier from public.discount_requests r where r.request_id = given_request;
                    if found then
                        raise exception 'request_reused';
                    end if;
                    if exists (
                        select 1 from public.discount_requests r
                        where r.lead_id = save_sibling_choice.lead_id and r.kind = 'sibling' and r.state = 'pending'
                    ) then
                        raise exception 'already_pending';
                    end if;
                    select * into member from public.sibling_group_members m where m.lead_id = save_sibling_choice.lead_id;
                    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
                    insert into public.discount_requests (
                        lead_id, kind, note, requested_by, request_id, group_id, sibling_of_lead_id
                    )
                    values (
                        save_sibling_choice.lead_id, 'sibling', note, staff_id, given_request,
                        member.group_id, member.sibling_of_lead_id
                    )
                    returning id into new_request;
                end if;
            end if;

            if question is not null then
                raise exception using errcode = 'P0115', message = 'sibling_question', detail = question::text;
            end if;
        exception
            when sqlstate 'P0115' then
                get stacked diagnostics failed_detail = pg_exception_detail;
                return jsonb_build_object('result', 'question', 'student', save_sibling_choice.student)
                    || failed_detail::jsonb;
            when others then
                get stacked diagnostics
                    failed_message = message_text,
                    failed_state = returned_sqlstate,
                    failed_detail = pg_exception_detail,
                    failed_hint = pg_exception_hint;
                begin
                    detail_json := coalesce(nullif(failed_detail, '')::jsonb, '{}'::jsonb);
                    if jsonb_typeof(detail_json) <> 'object' then
                        detail_json := jsonb_build_object('reason', failed_detail);
                    end if;
                exception when others then
                    detail_json := jsonb_build_object('reason', failed_detail);
                end;
                if save_sibling_choice.student is not null then
                    detail_json := detail_json || jsonb_build_object('student', save_sibling_choice.student);
                end if;
                raise exception using
                    errcode = failed_state,
                    message = failed_message,
                    detail = detail_json::text,
                    hint = coalesce(failed_hint, '');
        end;

        return jsonb_build_object(
            'result', 'linked',
            'basis', linked ->> 'basis',
            'group_id', linked ->> 'group_id',
            'left_group', linked ->> 'left_group',
            'request_id', new_request
        );
    end;
    $fn$;

    revoke execute on function public.save_sibling_choice(uuid, uuid, jsonb, integer) from public, anon, authenticated, service_role;

    perform public.assert_fee_snapshot_unchanged('pg_temp.repeated_answers_snapshot_before');
    drop table pg_temp.repeated_answers_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
