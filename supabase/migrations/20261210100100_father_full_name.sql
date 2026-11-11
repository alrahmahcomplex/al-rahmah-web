-- The father's full name on each lead, and the three-level name check (#299,
-- spec #296, align brief S2 and S5, R40, R41, R44).
--
-- 1. Two columns on leads: the father's full name and where it came from:
--    `derived` (from the student's name when the lead was entered),
--    `backfilled` (by this migration, never counted as staff-confirmed),
--    `edited` (corrected by staff) or `typo_confirmed` (a typing mistake
--    staff confirmed). Both are empty together.
-- 2. A trigger fills it on every insert from a name of two or more words,
--    whatever path creates the lead, and fills it again when the student's
--    name changes while the source is `derived` or `backfilled` (#299). An
--    empty one stays empty; staff add it at check-in or on linking. A
--    staff-entered value (`edited`, `typo_confirmed`) never moves with the
--    student's name. Name
--    corrections already pass the duplicate check in update_lead_details
--    before the row changes, so every re-derivation does too.
-- 3. father_name_match(a, b): `same`, `close` or `different` (S5). It only
--    ever tells a person to look; it grants nothing.
-- 4. split_student_name(name): the four parts the check-in form prefills.
-- 5. A backfill from stored student names of three or more words, checked
--    to move no fee, discount, status or Seat priority.
--
-- None of these functions is granted to an API role. The sibling-linking
-- functions (#301) call them as their owner.

-- ---------------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------------

create type public.father_name_source as enum ('derived', 'backfilled', 'edited', 'typo_confirmed');

alter table public.leads
    add column father_full_name text,
    add column father_full_name_source public.father_name_source,
    add constraint leads_father_full_name_not_blank
        check (father_full_name is null or btrim(father_full_name) <> ''),
    add constraint leads_father_full_name_has_source
        check ((father_full_name is null) = (father_full_name_source is null));

comment on column public.leads.father_full_name is
    'The father''s full name: the words after the first in the student''s name, unless staff corrected it. Compared through father_name_match.';
comment on column public.leads.father_full_name_source is
    'derived (from the student''s name at entry), backfilled (by migration 20261210100100, never staff-confirmed), edited (corrected by staff) or typo_confirmed (a typing mistake staff confirmed).';

-- ---------------------------------------------------------------------------
-- The student's name in words. Words are separated by any run of
-- whitespace. Whitespace at either end, tabs and line breaks included, is
-- dropped first: btrim alone removes only spaces.
-- ---------------------------------------------------------------------------

create function public.student_name_words(name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
    select case
        when t = '' then array[]::text[]
        else regexp_split_to_array(t, '\s+')
    end
    from (select regexp_replace(coalesce(student_name_words.name, ''), '^\s+|\s+$', '', 'g') as t) trimmed;
$$;

revoke execute on function public.student_name_words(text) from public, anon, authenticated, service_role;

-- The father's full name a student's name gives: the words after the first,
-- joined with single spaces, when the name has at least `min_words` words
-- (never fewer than 2); empty otherwise. New leads and name corrections use
-- 2 (#299). The backfill uses 3, since a stored two-word name may not hold
-- the father's name at all; staff add it at check-in or on linking.
create function public.derive_father_full_name(student_name text, min_words integer default 2)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when cardinality(w) >= greatest(coalesce(derive_father_full_name.min_words, 2), 2)
            then array_to_string(w[2:], ' ')
    end
    from (select public.student_name_words(derive_father_full_name.student_name) as w) words;
$$;

revoke execute on function public.derive_father_full_name(text, integer) from public, anon, authenticated, service_role;

-- The four parts the check-in form prefills from one stored name (S2): words
-- 1, 2 and 3, then every later word as the Surname. A part the name doesn't
-- have is empty.
create function public.split_student_name(
    name text,
    out first_name text,
    out fathers_name text,
    out last_name text,
    out surname text
)
language sql
immutable
set search_path = ''
as $$
    select w[1], w[2], w[3], nullif(array_to_string(w[4:], ' '), '')
    from (select public.student_name_words(split_student_name.name) as w) words;
$$;

revoke execute on function public.split_student_name(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Derive on insert; re-derive when the student's name changes.
-- ---------------------------------------------------------------------------

create function public.derive_lead_father_full_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        -- A caller that already holds the father's name (the multi-student
        -- form) passes it with its source; the constraint refuses one without
        -- the other.
        if new.father_full_name is null and new.father_full_name_source is null then
            new.father_full_name := public.derive_father_full_name(new.student_name);
            new.father_full_name_source := case when new.father_full_name is not null then 'derived' end;
        end if;
        return new;
    end if;

    -- An update that sets the father's name itself keeps what it set.
    if new.student_name is distinct from old.student_name
       and new.father_full_name is not distinct from old.father_full_name
       and new.father_full_name_source is not distinct from old.father_full_name_source
       and old.father_full_name_source in ('derived', 'backfilled') then
        new.father_full_name := public.derive_father_full_name(new.student_name);
        new.father_full_name_source := case
            when new.father_full_name is null then null
            -- A re-derived backfilled name is still not staff-confirmed.
            when old.father_full_name_source = 'backfilled' then 'backfilled'
            else 'derived'
        end::public.father_name_source;
    end if;
    return new;
end;
$$;

revoke execute on function public.derive_lead_father_full_name() from public, anon, authenticated, service_role;

create trigger derive_lead_father_full_name
    before insert or update of student_name, father_full_name, father_full_name_source on public.leads
    for each row
    execute function public.derive_lead_father_full_name();

-- ---------------------------------------------------------------------------
-- The three-level check (S5).
-- ---------------------------------------------------------------------------

-- A father's name as compared: lower case; . , ' ’ and - removed; runs of
-- whitespace made one space; trimmed. Empty when nothing is left.
create function public.normalize_father_name(name text)
returns text
language sql
immutable
set search_path = ''
as $$
    select nullif(
        btrim(regexp_replace(regexp_replace(lower(normalize_father_name.name), '[.,''’-]', '', 'g'), '\s+', ' ', 'g')),
        ''
    );
$$;

revoke execute on function public.normalize_father_name(text) from public, anon, authenticated, service_role;

-- The optimal-string-alignment distance between two words: the fewest
-- insertions, deletions, substitutions and swaps of two neighbouring letters
-- that turn one into the other, each counting 1, no letter edited twice
-- (R44). fuzzystrmatch's levenshtein counts a swap as 2, and the extension
-- is not enabled here.
create function public.word_edit_distance(a text, b text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
    n integer := char_length(a);
    m integer := char_length(b);
    width integer := m + 1;
    -- d[i][j], flattened: the distance between a's first i letters and b's
    -- first j, at index i * width + j + 1.
    d integer[];
    i integer;
    j integer;
    cost integer;
    best integer;
begin
    if n = 0 then
        return m;
    end if;
    if m = 0 then
        return n;
    end if;

    d := array_fill(0, array[(n + 1) * width]);
    for i in 0 .. n loop
        d[i * width + 1] := i;
    end loop;
    for j in 0 .. m loop
        d[j + 1] := j;
    end loop;

    for i in 1 .. n loop
        for j in 1 .. m loop
            cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
            best := least(
                d[(i - 1) * width + j + 1] + 1,
                d[i * width + j] + 1,
                d[(i - 1) * width + j] + cost
            );
            if i > 1 and j > 1
               and substr(a, i, 1) = substr(b, j - 1, 1)
               and substr(a, i - 1, 1) = substr(b, j, 1) then
                best := least(best, d[(i - 2) * width + j - 1] + 1);
            end if;
            d[i * width + j + 1] := best;
        end loop;
    end loop;

    return d[n * width + m + 1];
end;
$$;

revoke execute on function public.word_edit_distance(text, text) from public, anon, authenticated, service_role;

-- `same`, `close` or `different` for two fathers' names; empty when either
-- is missing, which is neither a match nor a mismatch.
--
-- Same: equal once normalized.
-- Close, either:
--   (a) the same number of words, compared in order; a total distance of at
--       most 2; and at most 1 on any pair where either word has 4 letters or
--       fewer (Ali/Abu is 2, so not close);
--   (b) one name is the other plus one extra final word, and the two share
--       at least 2 words (R41): "Ali Hassan Mohamed" against "Ali Hassan".
-- Different: anything else.
--
-- Close only ever raises the question to a person; nothing grants on it.
create function public.father_name_match(a text, b text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    left_name text := public.normalize_father_name(a);
    right_name text := public.normalize_father_name(b);
    left_words text[];
    right_words text[];
    shorter text[];
    longer text[];
    total integer := 0;
    distance integer;
    i integer;
begin
    if left_name is null or right_name is null then
        return null;
    end if;
    if left_name = right_name then
        return 'same';
    end if;

    left_words := string_to_array(left_name, ' ');
    right_words := string_to_array(right_name, ' ');

    if cardinality(left_words) = cardinality(right_words) then
        for i in 1 .. cardinality(left_words) loop
            distance := public.word_edit_distance(left_words[i], right_words[i]);
            if distance > 1 and least(char_length(left_words[i]), char_length(right_words[i])) <= 4 then
                return 'different';
            end if;
            total := total + distance;
            if total > 2 then
                return 'different';
            end if;
        end loop;
        return 'close';
    end if;

    if abs(cardinality(left_words) - cardinality(right_words)) = 1 then
        if cardinality(left_words) < cardinality(right_words) then
            shorter := left_words;
            longer := right_words;
        else
            shorter := right_words;
            longer := left_words;
        end if;
        if cardinality(shorter) >= 2 and longer[1:cardinality(shorter)] = shorter then
            return 'close';
        end if;
    end if;

    return 'different';
end;
$$;

revoke execute on function public.father_name_match(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill (S2, R40): every lead whose stored student name has three or more
-- words gets the words after the first, as `backfilled`. Closed leads too,
-- so a reopened one has it; the closed-lead guard is off for this statement
-- only. The father's name feeds no fee yet, and the check below proves no
-- fee, discount, status or Seat priority moved.
-- ---------------------------------------------------------------------------

select public.set_audit_actor('system');

create temporary table father_name_fee_snapshot as
select
    l.id,
    l.status,
    l.closure,
    to_jsonb(f) as fee,
    to_jsonb(s) as seat
from public.leads l
cross join lateral public.lead_fee_amounts(l.id) f
cross join lateral public.lead_seat_priority(l.id) s;

alter table public.leads disable trigger refuse_closed_lead_change;

update public.leads l
set father_full_name = public.derive_father_full_name(l.student_name, 3),
    father_full_name_source = 'backfilled'
where l.father_full_name is null
  and public.derive_father_full_name(l.student_name, 3) is not null;

alter table public.leads enable trigger refuse_closed_lead_change;

do $$
declare
    moved uuid;
begin
    select coalesce(b.id, a.id) into moved
    from father_name_fee_snapshot b
    full join (
        select l.id, l.status, l.closure, to_jsonb(f) as fee, to_jsonb(s) as seat
        from public.leads l
        cross join lateral public.lead_fee_amounts(l.id) f
        cross join lateral public.lead_seat_priority(l.id) s
    ) a on a.id = b.id
    where a.id is null
       or b.id is null
       or a.status is distinct from b.status
       or a.closure is distinct from b.closure
       or a.fee is distinct from b.fee
       or a.seat is distinct from b.seat
    limit 1;
    if moved is not null then
        raise exception 'father_name_backfill_moved_a_fee' using detail = moved::text;
    end if;
end;
$$;

drop table father_name_fee_snapshot;
