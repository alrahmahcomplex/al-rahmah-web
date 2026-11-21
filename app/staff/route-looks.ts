// Every staff route, all drawn in the new shell (#316). The redesign
// converted them one by one; the old shell is gone (#332), so "new" is the
// only look a route can have.
//
// Every page.tsx under app/staff/ has its pattern here (a unit test fails on
// one that is missing). scripts/design-lint.mjs reads the entries straight
// from this file to find each route's files, so keep each entry as
// `"/staff/x": "new"`. No imports: the lint and the tests read it.

export type Look = "new"

export const ROUTE_LOOKS = {
  "/staff": "new",
  "/staff/[...rest]": "new",
  "/staff/agents": "new",
  "/staff/agents/import": "new",
  "/staff/applicants": "new",
  "/staff/applicants/[id]": "new",
  "/staff/applicants/[id]/history": "new",
  "/staff/applicants/[id]/reopen": "new",
  "/staff/audit": "new",
  "/staff/check-in": "new",
  "/staff/check-in/[id]": "new",
  "/staff/check-in/new": "new",
  "/staff/discounts": "new",
  "/staff/family": "new",
  "/staff/fees": "new",
  "/staff/fees/[year]": "new",
  "/staff/follow-ups": "new",
  "/staff/group-links": "new",
  "/staff/interviews": "new",
  "/staff/kit": "new",
  "/staff/promo-codes": "new",
  "/staff/re-applications": "new",
  "/staff/re-applications/[id]": "new",
  "/staff/reopenings": "new",
  "/staff/reports": "new",
  "/staff/roles": "new",
  "/staff/seats": "new",
} as const satisfies Record<string, Look>
