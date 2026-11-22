-- The courtesy SMS (#503 slice 4b, decision 78, O-N49): when an agent joins
-- by email self-confirm, one SMS goes to the mobile on file, so the real
-- agent hears of it if someone else opened the account. A mobile finish texts
-- the mobile on file already (or there is none), so it gets no courtesy SMS.
-- Sent once per self-confirm invite: the attempt that sent it remembers.
--
-- Rollback: drop the function and the column.

alter table public.agent_confirm_attempts add column courtesy_claimed_at timestamptz;

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
    -- The attempt that sent the agent's latest invite.
    select a.* into attempt from public.agent_confirm_attempts a
    where a.agent_id = agent.id
      and a.invite_event = (
          select e.id from public.agent_events e
          where e.agent_id = agent.id and e.kind = 'invite' and e.result = 'started'
          order by e.created_at desc, e.id desc limit 1
      )
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
