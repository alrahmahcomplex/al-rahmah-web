# 7. Custodian, brought-by and sibling group are separate

Date: 2026-11-11

## Status

Accepted. The owner approved the rules on 2026-11-11 and ordered the build (#291, spec #296). Replaces the Family-based Sibling discount from `20261106901100_sibling_discount.sql`.

## Context

One link, the lead's guardian contact, decided five things: who the school holds responsible, duplicate matching, the Family, the Returning family flag and WhatsApp invitation, and the Sibling discount. Real families don't fit that:

- One adult often brings their own children and a relative's or friend's child on the same visit.
- One person can be Mother to one child and Aunt to another, but the relationship was stored on the person.
- The school's sibling rule is "same father", proven by matching names or by birth certificates. Any children on one contact counted as siblings once the Family was confirmed, including every child on one Admission form.
- Nobody recorded who brought the child, the father's name or the previous school.

The system records fees for information only. It handles no money, and the family's invoices and joining instructions come from the school on paper. The owner wants the data accurate but not rigid: a person who may edit fees can correct one, with an audit entry.

## Decision

**Three separate ideas.** Each child has one **custodian**, the adult responsible for its school obligations, with the relationship stored on the child's lead; the person is stored once per normalized phone and keeps the `guardian_contacts` table. **Brought by** is three plain fields on the lead (name, phone, relationship), a record only. **Sibling group** membership decides the Sibling discount; the only other source is the "Has a sibling already at Al-Rahmah" tick, which stays per lead and makes no group member. The Family keeps duplicate matching, Returning family and the WhatsApp invitation, and grants no discount.

**The father's full name comes from the student's name.** Staff enter the student's name in four parts: First name, Father's name, Last name, and an optional Surname. The student name stays one stored field, the parts joined with single spaces, so the duplicate check, exports and corrections are unchanged. The father's full name is the parts after the first, stored in its own field with a source: `derived`, `backfilled` (by the migration, never counted as confirmed), `edited` or `typo_confirmed`. A trigger derives it on every insert, whatever path created the lead. A change to the student's name re-derives it only while its source is `derived` or `backfilled`, so a staff correction or a typo-confirmed spelling survives.

**Siblings share a father, checked at three levels.** On "Sibling of" and on every edit of a grouped child's father's name, the normalized names (lower case; `. , ' ’ -` removed; whitespace collapsed; trimmed) are compared:

1. Same: siblings automatically.
2. Close: one alert to the desk staff. "Typing mistake" writes the chosen spelling to every group member holding the replaced one, in one audited step. "Two different names" opens a Sibling request.
3. Different: a Sibling request to the Admissions Manager (`discounts.approve`), with a note on the proof.

Close means the same number of words with a total optimal-string-alignment distance of at most 2 and at most 1 on any word of four letters or fewer, or one extra final word with the shared words equal and at least two shared. A small plpgsql function computes it; `fuzzystrmatch` is not enabled, and its `levenshtein` counts a swap of neighbouring letters as 2. An edit is checked against the value before it, and a refused member stays refused until a new request is granted, so an edit can't get round the Manager.

**Fee rule.** A member counts when it matched, was typo-confirmed, was granted or is legacy, and is not Declined, Inactive or Archived.

1. If a counting member is Enrolled without the 10%, every counting member not yet Enrolled gets 10%, whatever its fee (the owner's January and April case).
2. Otherwise the group stores one full payer, chosen when it first has two counting members: the highest School fee before discount among members not yet Enrolled, skipping larger-discount and manual members, the oldest lead on a tie, with students on one form ranked together. The others get 10% at once. A sibling who joins later gets the 10% and does not displace the full payer. A new full payer is chosen only when the stored one stops counting or gets a manual value.
3. A member's result is fixed when it becomes Enrolled and survives payment corrections. The system never changes an Enrolled student's result by itself. A member that a payment correction takes out of Enrolled keeps its locked result, is not ranked under rule 2, is not recomputed and is not an anchor.

Each lead stores one Sibling result (`full`, `ten` or `none`) with a source (`auto`, `locked`, `manual`, `legacy` or `prior_sibling`). It replaces `sibling_kept`, and every fee reader uses it through `lead_fee_amounts`. Only the group recompute writes `auto` results, under the group lock. It never rewrites `locked`, `manual` or `legacy` results (spec #296).

**Manual Sibling fee edit.** `payments.record` already covers maintaining fee amounts, so it also sets a student's Sibling result to Full fee, 10% or Back to automatic, with a reason from a fixed list and an audit entry. "Back to automatic" on an Enrolled student restores the locked result. The largest-discount rule still applies. A Sibling request granted for an Enrolled student makes it count for its siblings but leaves its own fee alone and marks "Granted: fee edit needed" for the Accountant.

**Legacy members.** Each confirmed Family of two or more leads becomes a group whose members are legacy. A legacy member not yet Enrolled keeps today's rule exactly (10% only when another counting member is Enrolled) and gives the 10% only as an Enrolled anchor. It leaves legacy when staff confirm its father's name; linking a new child to it confirms the name first. Leaving legacy never raises a fee: a lost 10% is kept with cause "left legacy" and counted for the Accountant.

**Migration safety.** The schema ships one release before the app that uses it. The migration snapshots every lead's fee, discount, status and seat counts, backfills, compares, and raises on any difference, so the hosted run fails safe. A forward kill switch stops new Sibling 10% grants without touching Enrolled fees. Locks are taken in the order academic year, Families, groups, rows, each set sorted, with a re-read retry for the group key.

**Previous school** is three fields on the lead with a "Not known yet" marker, asked from STD 2 up. No constraint ties it to the class, and no rule reads it.

## Considered options

- **Keep the Family as the sibling unit with a per-child "not a sibling" flag.** Rejected: it can't express a mother with children by two fathers, or a sibling with a different custodian.
- **First child to enrol pays full.** Rejected by the owner: the invoice for the highest-fee child is set when the family registers, whichever child is paid for first.
- **The highest fee always pays full, even against a later sibling.** Rejected: it would rewrite a fee the family already holds on paper.
- **Exact-only name matching.** Rejected by the owner: a one-letter typing mistake shouldn't need the Manager.
- **Fuzzy matching that grants by itself.** Rejected: it would give money on a guess. A person always answers the alert.
- **A grant that applies the 10% to an Enrolled student by itself.** Rejected: the owner gave that change to a person who may edit fees, and the Admissions Manager template doesn't hold `payments.record`.
- **The relationship on the person.** Rejected: one person can be Mother to one child and Aunt to another.
- **Working out the group on every fee read.** Rejected: it loops over members inside seat ranking. The stored result is read once and audited when it changes.

## Consequences

- The front desk asks more per child, softened by the four-part name, the father-custodian question and "Not known yet" for the previous school.
- The relationship moves from the contact to the lead. A sync trigger and a fallback cover one release; a later migration drops the contact's column after rewriting every reader.
- If the full payer never enrols, the cheaper sibling keeps the 10% until the Accountant resets it. A count lists these students.
- "Data-entry correction" lets the Accountant give the 10% without the Manager. A count of manual edits by reason and accountant makes it visible.
- A name like "bin Ali" or "binti Ali" lands in the father's full name as typed; staff confirm the split at check-in.
- The recompute and lock rules move from the Family to the group. The legacy gate is removed by a later migration once no legacy member not yet Enrolled remains.
