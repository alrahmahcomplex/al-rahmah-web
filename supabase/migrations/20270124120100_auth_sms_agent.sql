-- The Send SMS hook's one question (#503 slice 2b): which agent, if any, may
-- be texted a confirmation number for this Auth login right now. Supabase
-- Auth gives a session to whoever types the number, so only an agent who
-- can use the Discount code pages gets one: linked to the login, Approved,
-- not switched off or retired, with agent access on. The secret key alone
-- may ask (the hook runs with it); agent_access_settings stays closed to
-- every client role.

create function public.auth_sms_agent(login uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select m.id
    from public.marketing_agents m
    where m.user_id = auth_sms_agent.login
      and m.status = 'Approved'
      and m.switched_off_at is null
      and m.retired_at is null
      and (select s.enabled from public.agent_access_settings s where s.singleton)
$$;

revoke execute on function public.auth_sms_agent(uuid) from public, anon, authenticated;
grant execute on function public.auth_sms_agent(uuid) to service_role;
