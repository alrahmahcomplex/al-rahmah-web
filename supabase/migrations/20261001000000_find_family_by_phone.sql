-- Matching a walk-in parent to a known Family (slice 2). The front desk asks
-- for the parent first, then looks for every contact that already holds one
-- of their numbers, so staff can confirm it is the same person before any
-- child is typed.
--
-- A read, so it runs as the caller and row-level security still applies. It
-- checks leads.view itself anyway, so a staff member without it is told so
-- instead of being told nobody matched. Refusals raise a stable code as the
-- error message: `not_permitted`, or `invalid` with the field as JSON in the
-- detail, as create_lead does.

-- Every contact whose direct or WhatsApp number equals either given number
-- after normalize_phone, oldest first, each with the children on it. Names
-- are never compared. Returns the numbers as normalized too, so the screen can
-- compare what was typed with what is on file.
create function public.find_family_by_phone(phone text, whatsapp text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    direct text;
    other text;
    phones text[];
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    direct := public.normalize_phone(coalesce(find_family_by_phone.phone, ''));
    if direct is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    other := nullif(btrim(coalesce(find_family_by_phone.whatsapp, '')), '');
    if other is not null then
        other := public.normalize_phone(other);
        if other is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if other = direct then
            other := null;
        end if;
    end if;

    phones := array_remove(array[direct, other], null);

    return jsonb_build_object(
        'phone', direct,
        'whatsapp', other,
        'contacts', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', g.id,
                    'full_name', g.full_name,
                    'relationship', g.relationship,
                    'relationship_description', g.relationship_description,
                    'phone', g.phone,
                    'whatsapp', g.whatsapp,
                    'children', coalesce((
                        select jsonb_agg(
                            jsonb_build_object(
                                'id', l.id,
                                'admission_number', l.admission_number,
                                'student_name', l.student_name,
                                'class_name', l.class_name,
                                'enrollment_year', l.enrollment_year,
                                'status', l.status,
                                'closure', l.closure
                            )
                            order by l.created_at, l.id
                        )
                        from public.leads l
                        where l.guardian_contact_id = g.id
                    ), '[]'::jsonb)
                )
                order by g.created_at, g.id
            )
            from public.guardian_contacts g
            where g.phone = any (phones) or g.whatsapp = any (phones)
        ), '[]'::jsonb)
    );
end;
$$;

revoke execute on function public.find_family_by_phone(text, text) from public, anon;
grant execute on function public.find_family_by_phone(text, text) to authenticated;
