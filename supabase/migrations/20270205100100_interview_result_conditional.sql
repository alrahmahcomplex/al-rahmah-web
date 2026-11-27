-- A third interview result, Conditional (owner decision of 2026-11-27): the
-- child is below the pass mark, but the school takes them on an agreement the
-- family signs with the head of school before paying the School fee.
--
-- On its own in this file: a new enum value can be used only once the
-- statement that adds it has committed, and the next migration's functions
-- compare against it. It sits between Passed and Failed, so ordering by
-- result reads Passed, Conditional, Failed.

alter type public.interview_result add value if not exists 'Conditional' before 'Failed';
