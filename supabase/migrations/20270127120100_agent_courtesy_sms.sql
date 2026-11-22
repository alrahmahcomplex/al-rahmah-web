-- The courtesy SMS (#503 slice 4b, decision 78, O-N49): when an agent joins
-- by email self-confirm, one SMS goes to the mobile on file, so the real
-- agent hears of it if someone else opened the account. A mobile finish texts
-- the mobile on file already (or there is none), so it gets no courtesy SMS.
-- Sent once per self-confirm invite: the attempt that sent it remembers.
--
-- Rollback: drop the function and the column.

alter table public.agent_confirm_attempts add column courtesy_claimed_at timestamptz;

-- The self-confirm attempt behind the agent's invite: the one that sent the
-- latest self-confirm invite, unless a Manager invited the agent since. A
-- public "Tuma kiungo kipya" resend (no staff member behind it, no attempt)
-- keeps it: the account still opens from a self-confirm.
create function public.self_confirm_invite_attempt(agent_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select a.id
    from public.agent_confirm_attempts a
    join public.agent_events e on e.id = a.invite_event
    where a.agent_id = self_confirm_invite_attempt.agent_id
      and not exists (
          select 1 from public.agent_events staff
          where staff.agent_id = self_confirm_invite_attempt.agent_id and staff.kind = 'invite' and staff.result = 'started'
            and staff.created_by is not null and staff.created_at > e.created_at
      )
    order by e.created_at desc, e.id desc
    limit 1
$$;

revoke execute on function public.self_confirm_invite_attempt(uuid) from public, anon, authenticated, service_role;

-- Whether the agent's invite came from self-confirm, as above (it read only
-- the latest invite before, which a public resend replaced).
create or replace function public.agent_invited_by_self_confirm(agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.self_confirm_invite_attempt(agent_invited_by_self_confirm.agent_id) is not null
$$;

-- For a login that just set its password from a self-confirm invite: the
-- mobile on file to text and the email the account opened with, once. Null
-- outcome fields when there is nothing to send: not an agent's login, not
-- joined, no mobile on file, not a self-confirm invite, or already claimed.
-- Secret key only.
create function public.claim_self_confirm_courtesy(login uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    attempt public.agent_confirm_attempts;
    opened_with text;
begin
    select m.* into agent from public.marketing_agents m where m.user_id = claim_self_confirm_courtesy.login for update;
    if not found or agent.retired_at is not null or agent.switched_off_at is not null
       or agent.phone is null or agent.phone !~ '^\+255[67][0-9]{8}$'
       or not public.agent_joined(claim_self_confirm_courtesy.login) then
        return jsonb_build_object('outcome', 'none');
    end if;
    -- The self-confirm attempt behind the agent's invite.
    select a.* into attempt from public.agent_confirm_attempts a
    where a.id = public.self_confirm_invite_attempt(agent.id)
    for update;
    if not found or attempt.courtesy_claimed_at is not null then
        return jsonb_build_object('outcome', 'none');
    end if;
    select u.email into opened_with from auth.users u where u.id = claim_self_confirm_courtesy.login;
    if opened_with is null then
        return jsonb_build_object('outcome', 'none');
    end if;
    update public.agent_confirm_attempts a set courtesy_claimed_at = clock_timestamp() where a.id = attempt.id;
    return jsonb_build_object('outcome', 'send', 'phone', agent.phone, 'agent', agent.id, 'opened_with', opened_with);
end;
$$;

revoke execute on function public.claim_self_confirm_courtesy(uuid) from public, anon, authenticated;
grant execute on function public.claim_self_confirm_courtesy(uuid) to service_role;
