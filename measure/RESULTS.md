# Test signal measurement, 13 November 2026

Throwaway branch. Nothing here merges. Main at e104a93.

- Baseline: the whole suite 10 times on unchanged code, [run 43378264279](https://github.com/alrahmahcomplex/al-rahmah-web/actions/runs/43378264279).
- Planted bugs: 30 bugs from `mutants.json`, each run against the whole suite, [run 43378854700](https://github.com/alrahmahcomplex/al-rahmah-web/actions/runs/43378854700).
- To reproduce the numbers: `gh run download <run> -D <dir>` for both runs, then `node measure/collect.mjs <dir> results.json` and `node measure/report.mjs results.json`.

## The suite

| Layer | Tests | Files | Test time per run |
|---|---|---|---|
| Unit | 1,517 | 129 | 72 s |
| Integration | 1,753 | 100 | 867 s |
| Browser | 462 | 82 | 1,521 s |

## Red runs with no cause in the code

40 full runs: 10 unchanged, 30 with a planted bug that has nothing to do with the tests below.

- **8 of 40 runs (20%) failed on a database deadlock.**
  - 7 times in `tests/integration/sibling-fee-edit.test.ts`, "when the full payer takes a manual 10%, the sibling not yet Enrolled becomes the full payer".
  - Once in `tests/integration/sibling-groups.test.ts`, "the migration-day backfill covers every backfill case".
- The two tests deadlock each other. The backfill test runs `alter table ... disable trigger` on `sibling_group_members`, `sibling_groups` and `discount_requests`, which locks each whole table. The fee-edit test holds a lock on `discount_requests` and waits for `sibling_groups`.
- 2 browser tests passed only on a retry, once each in the 10 baseline runs: `turnstile-placement.spec.ts` ("sits above Send on the Admission review step, in sw") and `referral-notice.spec.ts` ("a Referral link's code shows the notice in English").

## Planted bugs

29 valid. `t01` planted nothing because of a bug in `apply.mjs`, fixed since; its result is void.

| | Bugs | Caught | Missed |
|---|---|---|---|
| Database rules, money, permissions (m) | 16 | 14 | m07, m08 |
| App logic and security (t) | 8 | 7 | t09 |
| Screen wiring (u01, u02, a01) | 3 | 3 | |
| Pixels (a02, a03) | 2 | 0 | a02, a03 |

Which layer caught them:

- **Integration** caught all 14 of the database bugs that were caught. Browser tests also caught 5 of those 14, never alone.
- **Unit** caught all 7 of the app-logic bugs that were caught. Browser tests also caught 3 of those 7, never alone.
- **Browser** was the only layer to catch 3 bugs, all three screen wiring: the Decline form dropping its explanation, Record payment refusing an amount with commas, and a form field losing its label.
- **Pixel tests** caught neither pixel bug, with every pixel test still in the suite.

Tests that caught at least one bug: 16 unit, 67 integration, 25 browser. With 29 bugs that does not prove the rest are useless. It does show the overlap: one fee bug (m15) failed 26 integration tests and 6 browser tests.

## The misses

- **m07:** an agent who was switched off can still set up a login (`agent_login_open` without the `switched_off_at` check). No test fails.
- **m08:** a Promo code gives nothing on its last day (`>=` to `>` in `promo_amount_off`). No test checks the last day.
- **t09:** the student import refuses a visit dated today as a future date (`>` to `>=`). No test checks today.
- **a02, a03:** round buttons at 36px, and a page header too wide for a phone.

## What it says to do

1. Delete the migration-day tests that lock shared tables. They cause the 20%.
2. Add three small tests for m07, m08 and t09.
3. Keep browser tests for what only they catch: screen wiring and whole journeys. A rule the database enforces is proven by its integration test.
