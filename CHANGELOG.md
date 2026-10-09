# Changelog

Every release is tagged with [Semantic Versioning](https://semver.org). `v1.0.0` is
reserved for the complete Al-Rahmah web app, with the School Landing Page, Admissions
Portal and Referral Tracking System all implemented. Releases before that milestone
stay in the `0.x` range.

## Unreleased

### NEW

- The Accountant can record school-fee payments on a lead the Admissions Manager
  reopened with **Enrol without a retaken interview**, even though its interview was
  not Passed. A lead reopened to retake the interview still takes payments only once
  its interview result is Passed.
- On the Seats screen, each ranked lead in an over-full class has a **Decline: No seat
  available** link. It opens the lead's Decline with that reason already chosen.

### IMPROVED

- A lead declined while Enrolled and then reopened comes back as Interviewed and is
  Enrolled again straight away if its payments still qualify. Before, it waited for the
  next payment or fee change. The lead's history says the reopening enrolled it.

## October 9, 2026 `v0.51.0`

### NEW

- Admissions Staff can request a **Staff child** or **Qualified orphan** discount on a
  lead, with a note for the Admissions Manager. The lead's new Discounts panel shows
  the pending request, who raised it and when. A lead has one pending request at a
  time.
- The Admissions Manager has a **Discount requests** screen, oldest first, with a count
  of waiting requests in the navigation. They grant each request, or refuse it with a
  reason that the person who asked reads on the lead.
- A granted discount lowers the School fee at once: 25% for Staff child, 100% for
  Qualified orphan. A lead with both gets the larger one. The School fee section names
  the discount, and a lead whose payments now cover the lower fee becomes Enrolled.
- With a granted Qualified orphan discount, the Accountant can record **Fee waived**,
  with no amount. It makes the lead Full and Enrolled.
- The lead history shows each discount request, grant and refusal.

## October 9, 2026 `v0.50.0`

### NEW

- Leads at **First instalment** become **Enrolled** on their year's Academic-year start
  without anyone acting. A daily check runs just after midnight Tanzania time and
  enrols every First instalment lead whose year has started.
- The School fee section on such a lead says "By the Academic-year start", with the
  start date as the Enrolled date. The lead's history shows the change made by the
  System.

## October 8, 2026 `v0.49.0`

### NEW

- The Accountant can **Adjust** a school-fee payment on the lead screen: pick a reason
  (Wrong amount, Wrong payment type, Wrong payment date, Duplicate entry or Data-entry
  correction), state the corrected type, amount and date, and add a note if needed.
  The recorded payment never changes. If an adjustment is wrong, adjust the payment
  again; the newest one counts.
- **Duplicate entry** voids a payment, so it stops counting toward Total paid. A
  voided payment comes back with **Data-entry correction**.
- Each payment shows its original entry with every adjustment beneath it, and who made
  each and when. Adjust works on Declined, Inactive and Archived leads too, since it
  corrects history.
- Total paid, the Seat priority, Enrolled and the seat counts follow adjustments. When
  an adjustment changes the Seat priority or takes a lead in or out of Enrolled, the
  lead's history says so.

## October 8, 2026 `v0.48.0`

### NEW

- The dashboard on the staff home shows three more tiles: **Interviewed leads**, the
  number of children who sat an interview, and **Passed interviews** and **Failed
  interviews**, the number of interviews with each result. All three count by interview
  date, and each has its own period and Enrollment year filters.
- An interview counts once its result is recorded, whether or not its fee is paid, and it
  still counts after the lead is Declined, Inactive or Archived. A child who retakes the
  interview in the same period counts once in Interviewed leads, and each sitting counts
  in Passed or Failed. Correcting a result or an interview date moves the interview to
  the right count.

## October 8, 2026 `v0.47.0`

### IMPROVED

- When a lead is declined, or marked Inactive or Archived, its planned follow-up now
  closes with it. The lead's Follow-ups panel shows the date it was planned for as
  **Closed with the lead**, with the reason, and the lead's history says who closed it.
  Leads that closed before this change have their follow-ups closed the same way.

## October 8, 2026 `v0.46.0`

### NEW

- The Admissions Manager can **Approve** or **Reject** a Pending Reopening request on
  the lead screen, with the lead's full record and history in front of them. A Manager
  may approve a request they raised themselves.
- Approving reopens the lead in one step. A Declined lead goes back to the status it
  had before; a lead declined while Enrolled comes back as Interviewed. Any Inactive or
  Archived mark is cleared, so a lead both Declined and Archived needs only one approval.
- When the lead was declined after its interview, the Manager chooses **Retake the
  interview** or **Enrol without a retaken interview** before approving.
- Rejecting needs a written reason. The staff member who asked reads it on the lead,
  with who rejected it and when.
- A lead reopened after a decline shows **Reopened after decline** with the date and
  the approver, and keeps an **Initially declined** tag for good, on the lead and in
  the lead list and search results. The lead's history names each decision.

## October 6, 2026 `v0.45.0`

### NEW

- Staff have a **Follow-ups** screen with every planned contact in two lists.
  **Overdue** holds follow-ups whose date has passed, oldest first. **Upcoming** shows
  today's follow-ups under **Today**, then later ones, nearest first. Each row shows the
  student, class, enrollment year, status, the date and how many days it is overdue, the
  note, the last contact, and the parent or guardian with a phone number you can tap to
  call. A row opens the lead at its Follow-ups panel.
- The queue leaves out Declined, Inactive, Archived and Enrolled leads. A lead that
  drops back out of Enrolled comes back with its old follow-up.
- The staff menu shows how many follow-ups are overdue.

## October 6, 2026 `v0.44.0`

### NEW

- **New Student** has an optional **Referral code** field on the student step. It names
  the Marketing Agent as the code is typed, and Review won't go on with a code no agent
  holds. The review shows the code and the agent's name, and the new lead carries the
  code, with the staff member who entered it in its history.
- If the lead is created but its referral code can't be saved, the confirmation still
  shows the Admission Number, says the code wasn't saved, and links to the lead's
  Referral code panel to add it.

## October 6, 2026 `v0.43.0`

### NEW

- Staff have a **Re-applications** screen for Admission forms that named a child already
  on file. It lists the ones nobody has reviewed yet, oldest first, with the Admission
  Number, the student, the lead's status, when the form arrived and how many fields
  differ from the lead. **Show reviewed** lists the ones already dealt with and who
  reviewed each.
- The staff menu shows how many re-applications wait for review.
- A lead's screen lists every re-application the family has sent for that child, newest
  first, reviewed or not.
- Staff who may edit leads open a re-application, see what the family sent, and
  **Mark reviewed**. It takes the re-application off the list, also works on a Declined,
  Inactive or Archived lead, and shows in the lead's history with their name. Accountants
  can read re-applications but not mark them.

## October 6, 2026 `v0.42.0`

### NEW

- A new **Seats** screen, for the Admissions Manager, shows each class in a year, Day
  and Boarding: the seats set (or "Seats not set"), the seats taken, and how many of
  them are Full, First instalment and Deposit.
- A class with more leads than seats is listed under **Over capacity** with its leads
  ranked: Full first, then First instalment, then Deposit, then by the date each lead
  reached its priority, oldest first. Leads ranked past the last seat are marked.
- A lead takes a seat once it has a Seat priority. Declining a lead frees its seat;
  Inactive and Archived leads keep theirs.
- When a payment would give a lead a seat in a class that is already full, the
  payment review warns the Accountant before Confirm. The payment can still be
  recorded. A class whose seats aren't set never warns.

## October 6, 2026 `v0.41.0`

### NEW

- A family who opens the Admission form from a Discount code link finds the **Discount
  code** (*Code ya Punguzo*) already filled in on the last step. The form remembers it
  for 30 days, so coming back later without the link still fills it in, and a newer link
  replaces it.
- Parents can also type a code there themselves. The form says whether the code is
  confirmed, waiting to be confirmed, or not recognised, and shows the interview fee for
  each child and the total: TZS 30,000 per child with a confirmed code, TZS 50,000
  otherwise.
- A code the school doesn't recognise never stops the form. Every child the form adds
  carries the code, so staff can see it on the lead's Referral code panel and correct a
  typo there.

## October 6, 2026 `v0.40.0`

### NEW

- A lead becomes **Enrolled** from its payments, and nobody sets it by hand. The moment
  its Seat priority reaches **Full**, its status changes to Enrolled. A Deposit never
  enrols a lead, and First instalment waits for the Academic-year start.
- The School fee section on an Enrolled lead says what enrolled it and when, for
  example "By the Full payment of TZS 2,000,000" on 26 Sept 2026.
- If a correction takes an Enrolled lead back below the line, such as a higher fee in
  the Fee schedule or a change of class, year or Day or boarding, it goes back to the
  status it had before. Lowering a fee can enrol a lead that has already paid enough.
- The lead's history shows each change into or out of Enrolled and why it happened.
- A Declined lead keeps its status and its payments. An Inactive or Archived lead can
  still be enrolled by its payments and keeps its mark.
- Leads already paid in Full become Enrolled when this release goes live.

## October 5, 2026 `v0.39.0`

### NEW

- People the school wants to bring in families can get a **Discount code** (*Code ya
  Punguzo*) at `/discount-code`. They enter their name, phone and an optional WhatsApp
  number, and the code appears at once with their own link to the Admission form, a
  **Copy** button and **Share on WhatsApp**. The page is in Swahili unless they switch
  to English, and it explains that families who use the code get TZS 20,000 off the
  interview fee once the school confirms it.
- Registering again with the same phone shows the same code. Each new registration
  appears as **Pending** on the Marketing Agents screen.
- The page isn't linked from the home page and asks search engines not to list it, so
  the school decides who gets the address.

## October 5, 2026 `v0.38.0`

### NEW

- **Record follow-up** on a lead saves what happened when someone contacted the family:
  a comment, how they were reached (Phone call, WhatsApp, SMS or In-person), who made the
  contact (you, unless you pick a colleague) and when (now, unless you change it).
  Recording completes the current follow-up and plans the next one, a week ahead to start
  with.
- A contact nobody planned, such as the family phoning in, can be recorded too.
- On an Enrolled lead the next follow-up date is optional.
- The Follow-ups panel lists every contact, newest first, with when it was entered if
  that was more than an hour after the contact. A colleague who has since left still
  shows by name. The lead's history shows each contact.
- If someone else records or changes the follow-up while you have the form open, you're
  told nothing was saved and offered a reload.

## October 5, 2026 `v0.37.0`

### NEW

- Each lead has a **Referral code** panel showing the code, whether it is **Approved**,
  **Pending** or **Unrecognised**, and the Marketing Agent it belongs to. It also shows
  the expected interview fee: TZS 30,000 with "includes TZS 20,000 discount" for an
  Approved agent's code, TZS 50,000 otherwise.
- Admissions Staff and the Admissions Manager can add, change or clear the code. As they
  type, the agent's name appears under the box, and only a registered agent's code can be
  saved. Every change shows in the lead's history with the old and new code.
- When the Manager approves an agent, every lead carrying that agent's code drops to
  TZS 30,000 straight away.
- The Marketing Agents screen shows how many leads carry each agent's code.
- The Accountant sees the panel without Edit or Clear. A Declined, Inactive or Archived
  lead keeps showing its code and fee, with no actions.

## October 5, 2026 `v0.36.0`

### NEW

- A parent can apply for up to eight children on one Admission form and type their own
  details once. **Add another child** adds a card, and any card can be removed while
  more than one is left. The review shows every child, and the confirmation gives each
  child its own Admission Number.
- The form won't send the same child twice. It names the child and asks the parent to
  remove one card or correct the name.

## October 5, 2026 `v0.35.0`

### NEW

- When a parent sends the Admission form for a child the school already has on file,
  they get the same confirmation as for a new child, with that child's existing
  Admission Number. Nothing on the form says the child was already known, and no second
  lead is made.
- Behind the scenes the form is kept on the existing lead as a **Re-application**, with
  what the parent sent and which details differ from the lead. The lead gets the
  **Returning family** badge, and its history shows the re-application from the
  Admission form. The lead's details, status and closure mark stay as they were, even
  for a Declined, Inactive or Archived lead.
- A form with several children handles each one on its own: new children become
  Applied leads, and children already on file are recorded as re-applications. Sending
  the same form twice records nothing twice.

## October 4, 2026 `v0.34.0`

### NEW

- Staff who can see leads have a new **Interviews** screen in the staff menu. It lists
  one enrollment year's interview registrations in S/N order, with each child's Admission
  Number, name, class, day or boarding, result, score and interview fee. A name opens the
  lead.
- It opens on the current year, or the next year that has registrations, and offers
  every year that has them. Filters narrow the list to **No result yet**, **Passed** or
  **Failed**, and to **Paid** or **Not Paid**; the Accountant uses **Not Paid** to see
  who still owes the fee. The filters stay in the address, so a list can be shared.
- Declined, Inactive and Archived leads stay on the list with a marker, so no S/N goes
  missing.

## October 4, 2026 `v0.33.0`

### NEW

- The Accountant can **Record payment** on a lead whose interview was Passed. They pick
  the type (Full payment, Initial deposit, First instalment, Second instalment or Third
  instalment), enter the amount and the payment date, which starts at today and can be
  earlier but never later. Before anything is saved, a review shows the new Total paid,
  the balance and the Seat priority, and the payment is recorded only on **Confirm
  payment**. A recorded payment can't be changed.
- The School fee panel lists the lead's payments, newest first, each with who recorded it
  and when. Total paid and the balance now count them.
- Each lead shows its **Seat priority**: Full when the fee is paid, First instalment from
  40% of the fee, Deposit from the minimum Initial deposit. It follows the amounts, not the
  payment types, so a deposit that reaches 40% counts as First instalment. The lead list
  shows it in a new column.
- Recording is refused, with a sentence saying why, on a Declined, Inactive or Archived
  lead, on a lead whose interview wasn't Passed, on a year with no Fee schedule, and for
  an amount of zero or less. Admissions Staff and the Admissions Manager see the fee and
  the payments with no Record payment.
- The lead's history lists each payment for staff who may view payments, and leaves it
  out for everyone else.

## October 4, 2026 `v0.32.0`

### NEW

- Admissions Staff and the Admissions Manager can **Request reopening** on a Declined,
  Inactive or Archived lead. The form asks why the family is back, and the answer is
  required. It opens from the lead's banner, and from the front desk when a closed child
  turns up or a registration is refused as a duplicate.
- A lead holds one waiting request at a time. Anyone else who opens the form sees
  "Reopening already requested by" the person who asked, and the date.
- A **Reopening requests** panel on the lead shows the waiting request with its reason.
  The person who asked can **Withdraw** it, and can send a new one later. Earlier requests
  stay listed with who withdrew them and when, and the lead's history shows each request
  and withdrawal.

## October 4, 2026 `v0.31.0`

### NEW

- The interview panel shows the interview fee: **Paid** or **Not Paid**, the amount, and
  a note when the Referral code discount brings it down. Everyone who can see the lead
  sees it.
- The Accountant can **Mark paid**, even before the interview has happened. The amount
  is locked at that moment and shows as the amount paid, so a later change to the
  Referral code doesn't change it. Nobody types an amount.
- **Mark not paid** undoes a wrong click and releases the lock. The lead's history lists
  each change with the amount, who made it and when.
- Admissions Staff and the Admissions Manager see the fee but can't change it.

## October 4, 2026 `v0.30.0`

### NEW

- Admissions Staff and the Admissions Manager can **Mark inactive** a lead that has gone
  quiet but may come back, or **Archive** one that is finished for good. They pick a
  reason from the fixed list and can add a note. The lead keeps its status and becomes
  read-only.
- A Declined lead can be marked Inactive or Archived too, and an Inactive lead can still
  be archived. An Archived lead offers neither, and a mark is never taken off except by
  an approved reopening.
- The closed-lead banner shows the mark's reason, note, who set it and when. A lead that
  is both Declined and Archived shows the decline and the mark, each under its own
  heading. The lead's history records each mark.

## October 3, 2026 `v0.29.0`

### NEW

- Each lead has a **Follow-ups** panel showing when the school will next contact the
  family, with a note on what for, or "No follow-up scheduled". It says whether the date
  is due today, coming up or overdue.
- Admissions Staff and the Admissions Manager can **Schedule follow-up** with a date from
  today to one year ahead (tomorrow to start with) and an optional note. A lead has one
  follow-up at a time.
- **Change date** moves a follow-up to a new date and asks why. The panel lists every
  earlier date with its reason, and the lead's history shows each plan and each change,
  the old and new date included.
- The Accountant sees the panel with no actions. A Declined, Inactive or Archived lead
  keeps showing its last planned follow-up, with no actions.

## October 3, 2026 `v0.28.0`

### NEW

- Staff who can decline leads get a **Decline** button on an open lead. They pick a
  reason from the fixed list and can add an explanation, which **Other** requires. Before
  anything is saved, a confirmation shows the child's name, Admission Number, the reason
  and what happens next: the lead becomes read-only, and bringing it back needs a
  Manager's approval. Any open lead can be declined, an Enrolled one included.
- **No seat available** appears only for staff who can set the seats, so only they can
  release a seat this way.
- A Declined lead's banner shows the reason, the explanation, who declined it, when, and
  the status it held before. The history lists the decline with its reason.

## October 3, 2026 `v0.27.0`

### NEW

- After the interview, Admissions Staff and the Admissions Manager record the result on
  the lead's Interview panel: the interview date (today unless changed), **Passed** or
  **Failed**, and the score as a percentage. All three are needed. The score runs from 0
  to 100 with one decimal place at most, and the date can't be later than today or
  earlier than the day the lead was registered.
- Recording the first result makes the lead **Interviewed**. If the family applied
  online and had never visited, their visit is recorded on the interview date at the
  same time.
- The panel shows the interview date, result, score and the **Next action** that follows
  from it: **Complete enrollment** for Passed, **Contact the admissions office** for
  Failed.
- **Correct result** fixes a wrong date, result or score. It changes nothing else: the
  lead's status, the S/N and the interview fee stay as they were. The lead's History
  shows each result recorded and each correction, with the old and new values, who made
  it and when.
- The result can be recorded whether or not the interview fee is paid. Other roles,
  the Accountant among them, see the result but can't change it, and nobody can change
  it on a closed lead.

## October 3, 2026 `v0.26.0`

### NEW

- Staff who can view leads have a **Marketing Agents** screen in the navigation. It lists
  each agent's name, phone (tap to call), code, status, when they registered, and who
  approved them and when. Search finds an agent by name, code or phone number, and the
  list shows 50 agents a page.
- The Admissions Manager sees how many agents are Pending next to **Marketing Agents**,
  and the screen opens on the Pending agents, oldest first. **Approve** asks you to
  confirm the agent's name and code, then records you as the approver. Approval can't
  be undone. Admissions Staff and the Accountant see the same list with no Approve.
- Agents can't register themselves yet; the registration page comes next. Each agent
  gets a code made of their initials and three digits, such as `AJM-407`, and one phone
  number can hold only one agent.

## October 3, 2026 `v0.25.0`

### NEW

- The staff home now shows **Leads by enrollment class** beside the Visited leads count:
  every class from DAY CARE to FORM 4, in school order, with how many leads it has and
  the total. A class with no leads shows 0. Leads count by the day they were created, in
  Tanzania time, whatever their status or closure mark, under their current class and
  Enrollment year. The table has its own period and Enrollment year filters, so you can
  look at this week's new leads while Visited leads shows something else.

## October 3, 2026 `v0.24.0`

### NEW

- Nothing changes on screen yet. The app now holds the four approved Swahili result
  messages (Passed and Failed, for WhatsApp and for SMS) and fills them in with the
  parent's name, the child's name, the score and the Admission Number. It can also build
  the WhatsApp link that opens a chat with the message typed in, for Tanzanian mobile
  numbers only. Sending results to families will build on this.

## October 3, 2026 `v0.23.0`

### NEW

- The staff home now shows a **Visited leads** count below your account notices, for
  anyone whose role can view leads. It counts every lead by its Visit date, including
  leads since Declined, Inactive or Archived, and leaves out Applied leads that haven't
  visited yet.
- The filter icon on the count narrows it to a date, a week (Monday to Sunday), a month
  or a year in Tanzania time, and to one Enrollment year. The count says which period
  and year it shows, and **Show all time and all years** clears it.
- The chosen filters stay in the page address, so a reload keeps them and a copied link
  opens the same view. The address holds only dates and years.

## October 3, 2026 `v0.22.0`

### NEW

- The Admissions Manager sets each year's **Academic-year start** on its Fee schedule
  page. It must fall in January of that year; any other date is refused and nothing is
  saved.
- The Manager also sets the number of seats in each class, for day and for boarding. A
  class without a number shows **Seats not set**. Once set, a start date or a seat
  number can be changed but not cleared.
- If another Manager changed the same start or seat number while the form was open,
  the save is refused rather than undoing their change. Numbers the Manager didn't
  touch keep whatever was saved last.
- The Accountant and Admissions Staff see the start date and seats but can't change
  them. Every change is kept in history with who made it.

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
