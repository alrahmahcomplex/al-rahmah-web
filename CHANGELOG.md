# Changelog

Every release is tagged with [Semantic Versioning](https://semver.org). `v1.0.0` is
reserved for the complete Al-Rahmah web app, with the School Landing Page, Admissions
Portal and Referral Tracking System all implemented. Releases before that milestone
stay in the `0.x` range.

## October 3, 2026 `v0.21.0`

### NEW

- A Declined, Inactive or Archived lead says so at the top of its screen and explains
  that it is read-only. Staff who may ask for it to be reopened are told requests
  can't be sent yet, with a link to the reopening page. Open leads look as before.
- The database refuses every change to a closed lead, whichever screen or call it
  comes from.

### IMPROVED

- A parent or guardian shared with a closed brother or sister can now be corrected from
  the open child's screen. Only a contact whose children are all closed stays read-only.

## October 3, 2026 `v0.20.0`

### NEW

- A lead's screen has a **School fee** section for everyone who may see payments. It
  shows the annual fee for the lead's class band and Day or boarding, Total paid, the
  balance, and the three instalments with their amounts and due dates. The fee comes
  from the Fee schedule of the lead's own enrollment year. A lead whose year has no
  schedule yet says so and shows no amount.
- Correcting a lead's class, enrollment year or Day or boarding changes its fee
  straight away.

## October 3, 2026 `v0.19.0`

### NEW

- A lead's screen now has an **Interview** section. Admissions Staff and the Admissions
  Manager can register an Applied or Visited lead for interview, and the system gives it
  the next **S/N** for its enrollment year, counting from 1 for each year. The S/N is
  shown apart from the Admission Number and never changes, even if the lead's
  enrollment year is corrected later.
- A lead can be registered only once. A closed or Enrolled lead can't be registered, and
  staff are told why in a plain sentence. The Accountant and other roles without
  interview access see the S/N but no register button.
- The lead's **History** shows each registration with its S/N.

## October 3, 2026 `v0.18.0`

### NEW

- Parents can apply for a child from their phone. **Omba sasa** opens the Admission form:
  three short steps for the parent's details, the child's class, year and day or
  boarding, then a check of everything before sending. The parent gets the child's
  **Namba ya Udahili** to bring to campus, and the child appears on the Leads screen as
  Applied, with the Admission form named in its history. Switching language keeps
  what was typed. If sending fails, the form says so and keeps every entry, and
  sending the same form twice never creates a second lead.

## October 3, 2026 `v0.17.0`

### NEW

- The home page now welcomes parents in Swahili, with a short word on what Al-Rahmah
  offers, an **Omba sasa** button to the Admission form, and the admissions office phone
  as a tap-to-call link. **Staff sign-in** stays at the bottom.
- A switch at the top turns the site to English and back. The site remembers the choice,
  so the page opens in that language next time.

## October 1, 2026 `v0.16.0`

### NEW

- A **Fee schedule** screen holds each enrollment year's fees: a Day and a Boarding
  annual fee for Nursery, Primary STD 1 to STD 4, Primary STD 5 to STD 7 and
  Secondary, the three instalments' shares and due dates, the minimum Initial deposit,
  and the Pre-Form One programme fee for day and for boarding.
- The Accountant creates a year's schedule and corrects its amounts. A split that
  doesn't add up to 100%, or a missing, zero or negative amount, is refused with a
  sentence naming the field, and nothing is saved.
- Everyone who may see payments reads every year's schedule. The Admissions Manager
  sees the amounts but can't change them. Every change is kept in history with who
  made it.

## October 1, 2026 `v0.15.0`

### NEW

- Nothing changes on screen yet. The public Admission form and the discount code page
  will check each submission with Cloudflare's security check before saving anything,
  and turn it away if the check fails or Cloudflare can't be reached. They will also
  cap how often one connection can send each form. If the cap itself can't be checked,
  the form still goes through.

## October 1, 2026 `v0.14.1`

### IMPROVED

- Nothing changes on screen. The rule that a closed lead is read-only now lives in one
  place, which declining, archiving and reopening leads will build on.
- GitHub now runs every check on each change before it can merge, and the database
  tests finish in under a minute without waiting for a full build.

### FIXED

- A deploy could fail when Google Fonts answered in a form the build couldn't read.
  The site's two fonts now ship with it, so the build no longer depends on Google.

## October 1, 2026 `v0.14.0`

### NEW

- Every lead has a **History** screen, newest first. Each entry says when it happened
  in Tanzania time, who did it (a staff member by name, even one who has since been
  deactivated, or the Admission form), and each changed field's old and new value.
- A change to a parent or guardian shows on the history of every child on that contact,
  and a contact the lead was on before a separation stays in its history.
- Creations, recorded visits and Family joins, confirmations, rejections and
  separations each get a plain description. A kind of change the screen doesn't know
  yet still shows, under its stored name.

## October 1, 2026 `v0.13.0`

### NEW

- A lead's screen now has a **Family** section listing the brothers and sisters on
  file. Children the Admission form linked to the Family, and that staff haven't
  confirmed yet, are marked **Unconfirmed** there and in the New Student Family list.
- When the Admission form matched a parent's phone to a family already on file, the
  lead shows the match. **Confirm match** names every child it moves into that Family
  before it does. **Reject match** clears the match for those children and removes
  their **Returning family** badge, unless they applied again.
- **Separate from this Family** gives a lead that was wrongly joined to a Family its own
  copy of the parent or guardian, so later changes to the shared contact no longer
  reach it.

## September 30, 2026 `v0.12.0`

### NEW

- New Student now checks the parent's phone and WhatsApp numbers against every parent
  already on file. When one matches, you see their stored name and relationship and
  choose **Same person** or **Not the same person**.
- Once you confirm the parent, you see their children with Admission Number, class,
  enrollment year and status. **Open** takes you to an active child, and a Declined,
  Inactive or Archived child goes to the Reopening request page, so nothing is
  registered twice.
- **Register a new sibling** adds the child to the same parent and marks the lead
  **Returning family**. If the details you typed differ from the ones on file, you see
  both side by side and choose **Keep stored details** or **Update the shared contact**,
  which changes it for every brother and sister.

## September 30, 2026 `v0.11.0`

### NEW

- When a family who applied through the Admission form arrives, staff who record visits
  open their lead and use **Record visit**. The Visit date starts at today and can be
  set to an earlier day, never a later one, and saving moves the lead from Applied to
  Visited. Only Applied leads offer it, so a lead never goes back a step or gets a
  second first visit.

## September 30, 2026 `v0.10.1`

### IMPROVED

- The staff invite email now looks like the sign-in page: the Al-Rahmah logo on a white
  rounded card, an Exo italic "You're invited!" heading and an orange **Set your
  password** button. It's shorter too, and the link still works once and expires in an
  hour.

## September 30, 2026 `v0.10.0`

### NEW

- On a lead, staff who can edit leads now have **Edit student**, which corrects the
  student's name, class, enrollment year and Day or boarding, and **Edit parent or
  guardian**, which corrects the parent's name, relationship, phone and WhatsApp number.
  Phone numbers are stored the same way as at check-in.
- When a parent or guardian is shared by brothers and sisters, the edit form lists those
  children and their Admission Numbers before you save, because the change reaches
  every one of them.
- Staff who record visits can **Correct Visit date** to today or an earlier day.
- A correction that would make the student match another lead, by name and parent
  number, is refused and links to that lead. The Admission Number and status can't be
  changed this way. Declined, Inactive and Archived leads, and Accountants, see no edit
  actions. A parent or guardian shared with a closed lead can't be edited either, and
  the lead says which child is closed.

## September 30, 2026 `v0.9.0`

### NEW

- Staff who can view leads now have **Leads** in the staff navigation. One search box
  takes an Admission Number or part of a student's name. A number finds its lead
  whatever its status. A name finds every match regardless of capitals or extra spaces,
  with Inactive and Archived leads badged and listed after the rest.
- With nothing searched, **Leads** lists leads without a closure mark, newest first, 50
  to a page. Filters show Inactive, Archived or all leads, or one status, and they stay
  set as you page through. Each row shows the Admission Number, student, class,
  enrollment year, Day or boarding, status and any Returning family badge, and the
  student's name opens the lead.

## September 30, 2026 `v0.8.0`

### NEW

- **Check-in** now starts with the family's Admission Number. Staff type it and press
  **Continue** to open the lead, whatever its status, including Archived and Declined
  leads. `ADMSN-40719`, `admsn-40719` and `40719` all work, and extra spaces don't
  matter.
- A number that matches no lead says "No lead with this Admission Number", with
  **Try again**, which clears the field for the next attempt, and **New Student**, which
  starts registering the family. Accountants can look up and read leads the same way
  but see only **Try again**.

## September 30, 2026 `v0.7.0`

### NEW

- Staff who can view leads now have **Check-in** in the staff navigation. Admissions
  Staff and Admissions Managers see **New Student** there and can register a family who
  walks in: the parent or guardian first, then the child, a review, and a confirmation
  with the child's Admission Number in large type and a **Copy number** button.
- The new lead starts at **Visited**. The Visit date starts as today in Tanzania and
  can be moved earlier, never later.
- Phone numbers are accepted the way families say them (`0712 345 678`, `712345678`,
  `+255 712 345 678`, `255712345678`). A number that can't be read sends staff back to
  the parent step with a message, and nothing is saved.
- A child who is already on file, with the same name and a matching parent phone or
  WhatsApp number, is refused with "Already registered", the existing Admission
  Number and a link to that lead. Capital letters and extra spaces in the name don't
  matter. If that lead is closed, the link goes to a page that shows it read-only and
  says reopening isn't available yet.
- Each lead has a read-only screen showing the student, the parent or guardian, the
  status, the Visit date and the Admission Number. Accountants can read it too, but
  see no New Student button.

## September 29, 2026 `v0.6.0`

### NEW

- When someone else changes your role, deactivates you or reactivates you, the staff
  home tells you at your next sign-in who did it, what changed and on which date.
  **Dismiss** clears the message, and it doesn't come back.

## September 29, 2026 `v0.5.0`

### NEW

- On Staff and roles, an Admissions Manager can invite someone into the role in view
  by name and email. They get an email with a link to set their password, then sign in
  with that role's powers.
- People who haven't accepted their invite show as **Invited**, with **Resend invite**
  beside them. A new invite replaces the earlier link.
- If the email can't be sent, the person is still added and the screen says so, so
  the Manager can resend it later.
- An invite link that has expired or was already used says so and asks for a new one.
  Someone deactivated before they accept is told so, and can sign in with the password
  they chose once they're reactivated.
- History shows who sent each invite and who it went to.

## September 29, 2026 `v0.4.0`

### NEW

- On Staff and roles, an Admissions Manager can add a role with **New role** at the
  bottom of the list. It starts with nothing ticked.
- A Manager can rename a role and tick or untick what it can do. Changes apply to
  everyone in the role on their next click.
- A Manager can retire a role nobody active holds. It drops out of the choices and
  stays in history. If someone active still holds it, the screen names them.
- A role's heading says when it can't be changed: it's your own role, it's retired, or
  it can manage staff and roles. Those roles change only through a reviewed update to
  the system, and "Administer staff and roles" can't be ticked on any role.

## September 29, 2026 `v0.3.2`

### FIXED

- Nothing in the app changes in this release. The lint check no longer fails on a
  developer's machine where agents keep extra copies of the project inside it. It
  was reading the build files in those copies as if they were code to check.

## September 29, 2026 `v0.3.1`

### FIXED

- Staff signing in with the right password no longer sometimes see "Sign-in is
  unavailable right now". This happened when the database service briefly thought a
  sign-in made a moment ago came from the future. Sign-in now checks once more a
  second later, and still refuses if the staff record can't be read.

## September 28, 2026 `v0.3.0`

### NEW

- Admissions Managers have a Staff and roles screen, linked from the staff navigation.
  It lists every role with how many active staff hold it and what it allows, and the
  people in each role.
- From that screen a Manager can move someone to another role, deactivate or
  reactivate them, and correct their name. Moving or deactivating another Manager asks
  for confirmation first.
- A History section on the screen lists every change to staff and roles, newest
  first, with who made it and the old and new values.
- Staff whose role doesn't include a page now see a page saying so, instead of the
  page itself.

## September 28, 2026 `v0.2.0`

### NEW

- Staff now have roles. Each staff member holds one of Admissions Manager, Admissions
  Staff or Accountant, and every staff page shows their name and role at the top.
- Every change to a staff member or a role is kept in a history that nobody can edit
  or delete, with who made the change and when.

### IMPROVED

- Everyone who could sign in before keeps their access as an Admissions Manager, named
  after the first part of their email address until someone corrects it.
- A deactivated staff member who tries to sign in is told their account is
  deactivated, instead of a general refusal. Someone deactivated while signed in is
  sent back to sign-in on their next click.

## September 28, 2026 `v0.1.7`

### IMPROVED

- Nothing in the app changes in this release. The separate local database for each
  copy of the project, added in `v0.1.6`, is gone. It slowed down the developer's
  machine. Every copy shares one local database again, as it did in `v0.1.5`, and it
  starts only the parts the app uses.

## September 26, 2026 `v0.1.6`

### IMPROVED

- Nothing in the app changes in this release. Each copy of the project on a
  developer's machine now gets its own local database, so several people or agents
  can work side by side without wiping each other's data.

## September 25, 2026 `v0.1.5`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now settle
  the rest of the Admissions Portal before it is built: the Swahili WhatsApp and SMS
  result messages, how a reopening request is approved, how the front desk checks a
  family in and finds siblings, how school fees, discounts and seat priority decide
  when a student counts as enrolled, and which periods the dashboard reports by.

## September 25, 2026 `v0.1.4`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now list
  every permission a staff role can hold and what the Admissions Staff, Admissions
  Manager and Accountant roles start with. Only the Accountant marks the interview fee
  as paid, and all three roles can see school-fee payments.

## September 25, 2026 `v0.1.3`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now say how
  the Admissions Portal keeps its history: every change to a lead, payment, role or
  staff member records who made it, what it was before and what it became, and the
  history can never be edited or deleted.

## September 25, 2026 `v0.1.2`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now describe
  what comes next: parents applying online and getting an Admission Number, Marketing
  Agents and the discount codes parents enter, and staff roles the Admissions Manager
  can edit. Building starts from these.

## September 23, 2026 `v0.1.1`

### FIXED

- Fixed every page, the home page included, showing "Internal Server Error" since the
  first release.
- Fixed the home page and other public pages going down along with staff sign-in.
  When sign-in is misconfigured or down, only the staff pages are affected.

## September 22, 2026 `v0.1.0`

### NEW

- Added staff sign-in at `/login`, carrying the Al-Rahmah logo, palette and password
  visibility toggle across from the archived photo matcher.
- Added a staff allowlist. Only an email listed in `allowed_admin_emails` can sign in,
  the database refuses to create an account for any other address, and removing an
  email revokes access on that person's next request.
- Added a staff area at `/staff` that names the signed-in person and can sign them out.
- Added a public placeholder at `/` linking to staff sign-in, until the school landing
  page is built.
- Added the checks every later change runs against: `lint`, `typecheck`, `test`
  (Vitest), `test:e2e` (Playwright) and `build`.
- Added local Supabase through the CLI as a dev dependency, so the database, its
  migration and the fixture accounts come up with `npm run db:start` on the version
  pinned in the lockfile.

### IMPROVED

- Moved the app to Next.js 16 with the App Router, Tailwind v4 and shadcn `base-nova`.
  The archived repo mixed Next 15 with version 16 of its lint config.
- Left the photo matcher behind: Gemini, Firebase tools, IndexedDB, spreadsheet and
  archive handling, and the batch, student and dashboard screens are all gone.
- Session refresh now runs in `proxy.ts`, following the Next.js 16 rename of
  middleware, and authorization sits in the services and the database where it holds.

### FIXED

- Fixed the sign-in link handler sending people to another site. A crafted `next`
  parameter such as `?next=@evil.example` was treated as a destination; only paths on
  this site are followed now.
- Fixed an allowlisted email being claimable by a stranger. Public sign-up was open,
  so whoever registered a staff address first chose its password and was let in.
  Sign-up is off and staff accounts are created by invitation.
- Fixed sign-in blaming the password when the service was unreachable. An outage now
  says so instead of telling staff their password is wrong.
