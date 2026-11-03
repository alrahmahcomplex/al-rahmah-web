# Hosted services

Checking production, a Vercel Preview or a dashboard (GitHub, Supabase, Vercel) is the agent's job. The in-app browser holds the human's sessions and shares them across agent sessions, so:

1. Open the page in the in-app browser and see whether it is signed in.
2. If it shows a sign-in page, ask the human to sign in to that service or site (`AskUserQuestion` in Claude Code), wait for their answer that they are done, then open it again.
3. Report what the page shows.

A missing session is a sign-in to ask for, never a reason to hand the check to the human. Their calls are merges and destructive changes.

## Hosted setup

The hosted Supabase project is `al-rahmah-web`, linked to this repo. The human owns every change below; an agent asks for it and says why.

- **Migrations** reach the hosted database when their PR merges to `main`, through the Supabase GitHub integration. The agent confirms each version during the migration confirmation step in [Releasing](releasing.md).
- **Vercel** needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both Production and Preview. Next.js bakes `NEXT_PUBLIC_*` values in at build, so a changed value takes effect only after a redeploy. A Preview without them serves 500 on `/staff`, `/login` and `/auth`, and `before-and-after` then captures error pages.
- **The first staff member** on a fresh database: the sign-up trigger refuses any auth user without an active staff record, and every write to staff members needs an audit actor, so the order is fixed. First run this in the SQL editor, with the person's name and lowercase email:

  ```sql
  begin;
  select public.set_audit_actor('system');
  insert into public.staff_members (full_name, email, role_id)
  select 'Full Name', 'person@example.com', id from public.roles where name = 'Admissions Manager';
  commit;
  ```

  Then invite the user under Authentication → Users. Their link lands on the site root, which forwards it to `/auth/confirm`. Everyone after them is invited from Staff and roles.
- **Staff invites** from Staff and roles need, on the hosted project: custom SMTP (Authentication → SMTP Settings, with a verified sending domain; the built-in sender reaches only the project's team), the Site URL set to production, Redirect URLs allowing `/auth/confirm` on production and on `https://*-<vercel-team>.vercel.app/**`, the Invite user template from `supabase/templates/invite.html`, and a named secret key. Vercel needs that key as `SUPABASE_SECRET_KEY`, unprefixed, in Production and Preview. Without the key the Manager's invite still creates the staff record, reports that the email wasn't sent, and offers Resend invite.
