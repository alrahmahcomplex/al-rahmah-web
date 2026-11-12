-- The Sibling discount request (#302): the new kind and the new state, on
-- their own. A value added to an enum can't be used in the transaction that
-- adds it, so 20261214100200 uses them once this file has committed. Nothing
-- reads either value yet: no fee, discount, status or seat count moves.
--
-- Rollback: none needed. An unused enum value is harmless, and Postgres can't
-- drop one.

alter type public.discount_kind add value if not exists 'sibling';

alter type public.discount_request_state add value if not exists 'withdrawn';
