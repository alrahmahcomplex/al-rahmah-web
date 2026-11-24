---
bump: minor
---

### NEW

- Discount code holders now have their own app at `agents.alrahmahcomplex.or.tz` with its own
  indigo app icon, manifest and browser theme (`#2408B2`), while the staff Admissions Portal on
  `portal.alrahmahcomplex.or.tz` keeps its orange icon and theme (`#ee7300`).
- Each address now signs in only its own people: staff on `portal.alrahmahcomplex.or.tz` and
  Discount code holders on `agents.alrahmahcomplex.or.tz`. Signing in on the wrong address with
  the right password ends only that browser's new session and points to the right address;
  already-signed-in Discount code holders opening `portal.alrahmahcomplex.or.tz/auth` see a
  "Your pages have moved" notice with their masked login and a link to the new app.
- The Discount code dashboard moved from `/discount-code/students` to `/home` inside the shared
  shell, with dedicated `/students`, `/students/[id]` and `/reminders` screens, a top-bar search
  and 7-day activity bell, a filter menu with counts, a profile sheet, and local-only sign-out.
- Old bookmarks and email links (`/discount-code/students`, `/discount-code/sign-in`,
  `/discount-code/forgot-password`, `/discount-code/reset-password`) redirect to their new
  addresses in one hop.
