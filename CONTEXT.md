# Al-Rahmah Admissions

This context covers the work of capturing and progressing families who are considering admission to Al-Rahmah Schools. It focuses on admissions leads and their journey before enrolment.

## Language

**Admissions lead**:
A student record created in one of two ways: a parent or guardian submits the **Admission form**, and the lead begins as **Applied**; or a family with no submitted form completes a qualifying campus visit, and the lead begins as **Visited**. It may proceed to an admission interview, enrolment, or decline. The parent or guardian is a contact person or custodian associated with the lead, not the lead themselves.
_Avoid_: Parent, guardian, prospect, enquiry, applicant

**Words on screen**:
Staff and families never read "lead". On screen the person is an **applicant** ("12 applicants", the Applicants list at `/staff/applicants`), the record and its page are an **application** ("Open the application", "Application history"), and an **Enrolled** applicant is a **student**. Status names stay as they are. Code, routes in code, tables, columns, permission names and this glossary keep "lead"; the _Avoid_ line above is about them, not about screen text.

**Admission form**:
The public form, reached from the school landing page or from a **Referral link**, through which a parent or guardian applies for a student. Anyone may submit it without a referral. A successful submission creates an **Applied** admissions lead and shows the parent or guardian the lead's **Admission Number**.

**Enquiry**:
An initial expression of interest or request for information about admission that has not become an admissions lead, because no **Admission form** was submitted and no qualifying campus visit has happened.

**Follow-up**:
A planned contact or action intended to move an admissions lead toward a decision or completed admission.

**Enrolled student**:
A student whose admission has been completed. This is outside the current admissions-lead boundary unless the workflow explicitly hands the record over.

**Enrolled**:
The canonical lifecycle status for a completed admission. Legacy workbook values such as **Contracted** are translated to **Enrolled**.
_Avoid_: Contracted, Registered (when referring to the completed admissions outcome)

## Lead Lifecycle

An admissions lead moves through these statuses:

1. **Applied** — the parent or guardian has submitted the **Admission form** and the family has not yet come to campus.
2. **Visited** — the parent or guardian has completed a qualifying campus visit.
3. **Interviewed** — the child has completed an admission interview.
4. **Enrolled** — the admission has been completed.
5. **Declined** — the family or school has decided not to proceed with admission.

Leads normally move through the lifecycle in order: **Applied → Visited → Interviewed → Enrolled** or **Declined**. A walk-in lead with no **Admission form** starts at **Visited**. When an applied family's first time on campus is interview day, the visit and the interview are both recorded that day. An intervention may correct or advance a lead when the real-world event happened outside the system or was recorded late; the intervention should preserve the fact that the normal sequence was bypassed. Only the **Admissions Manager** may perform this intervention.

A lead remains **Visited** while follow-up is still possible, including when the legacy workbook describes it as **Visited, Not Registered**. Once follow-up concludes that the family will not return, such as because the child enrolled elsewhere, the responsible admissions staff member may mark the lead **Declined**. This is a normal transition and does not require Admissions Manager intervention.

An existing **Declined** lead must be reopened through a dedicated **Reopen** route rather than duplicated. Reopening requires Admissions Manager approval and preserves the original lead history.

Reopening does not erase or replace the original decline. The reopened lead retains its prior history and receives a **Reopened after decline** note. From the interview stage, the reopened path may either record a retaken interview with its new marks or proceed directly to **Enrolled** without another interview. Direct enrolment without a retaken interview receives the automatic **Initially declined** tag.

When an interview is retaken, the lead's current status becomes **Interviewed**. The retaken interview result and percentage score are the current values, while the earlier interview result and score remain preserved in interview history.

**Declined reason**:
A required choice from a fixed list recorded when a lead is marked **Declined**, describing why the family or school will not proceed. Staff may add an optional explanation. A lead cannot be concluded as declined without selecting a reason.

The initial choices are: **Enrolled elsewhere**, **Family changed plans**, **Fees or cost**, **Fee payment not completed**, **No seat available**, **Did not pass interview**, **Unreachable after follow-up**, **School decision**, and **Other**.

**Interview payment**:
The payment status for the admission interview, in Tanzanian shillings (TZS). The standard interview amount is **TZS 50,000**. A code on the lead takes a whole-shilling amount off it, from 0 to 50,000: an **Approved**, switched-on agent's **Referral code** takes the **Standard discount** (**TZS 10,000** when the system starts, so the expected amount is **TZS 40,000**) unless the agent has an own amount, and an Active **Promo code** takes its own amount. A paused, ended or expired Promo code, and a **Pending** or switched-off agent's code, take nothing off. Changing an amount or a code's state moves every fee not yet **Paid** that carries the code, and needs a reason. A fee already **Paid** keeps the amount locked when it was marked, and a family who pays less than the expected amount stays **Not Paid**. Staff cannot override the calculated fee. The Accountant records only **Paid** or **Not Paid**; payment date, method, and receipt reference are outside the current scope.

The fee belongs to each interview, not to the lead, so a retaken interview after a reopening starts **Not Paid** with its own fee. Marking it **Paid** locks the calculated amount at that moment, and a later change to the **Referral code** or the agent's approval does not change it. Marking it **Not Paid** again, to undo a wrong click, releases the lock; the next **Paid** locks the amount as it is then.

An unpaid interview may still be conducted and its result recorded internally. The interview result must not be released to the parent or guardian until the interview payment status is **Paid**.

Once payment is **Paid**, staff may release the result through a **Send through WhatsApp** action. This action generates a WhatsApp link containing a predefined message with the interview result and next action. It is an intentional staff-triggered release, not an unsolicited automatic message.

The result message is written in Swahili, uses warm and expressive language, congratulates the family when the result is **Passed**, and responds empathetically when the result is **Failed**. The message is structured for WhatsApp readability using appropriate bold, italics, and bullets.

**Result message**:
The prepared Swahili message that releases an interview result, one for **Passed** and one for **Failed**. It greets the parent or guardian it is sent to by name and gives the student's name, interview result, percentage score, **Admission Number** and **Next action**; the **Passed** message also gives the class and enrollment year, and the **Failed** message gives the admissions office phone number. It is signed by the admissions office, never by a staff member. Its wording is fixed: staff release it as prepared and cannot edit it in the system. It never mentions a retaken interview, which only a reopening can lead to.

**Send SMS** uses a separate, shorter plain-text version of each message with no formatting or emoji, so it fits in two SMS segments.

The WhatsApp action targets the parent/guardian's separate WhatsApp contact when available, otherwise it falls back to the direct phone contact. If no WhatsApp-capable number is available, the action is presented as **Send SMS**; it reveals the prepared message and the direct phone, each with a copy function, instead of generating a WhatsApp link. When WhatsApp is offered, staff may still choose **Send SMS instead** for a parent who turns out not to be on WhatsApp; the SMS then goes to the direct phone. Staff can never choose WhatsApp when no number can take it. When the names on a lead make the WhatsApp message too long, staff send it by SMS.

A release is recorded when the message leaves the app: for WhatsApp, the click on **Send through WhatsApp**; for **Send SMS**, the click that reveals the text to copy. The app cannot know whether the parent received it, so the lead's history records that staff sent it, by which channel, and the result and score it carried, never that the family got it.

Staff may send a result again, for a parent who lost the message or changed number. Once the current interview has a release, either send button first asks staff to confirm, saying when, how and by whom it was last sent; cancelling sends and records nothing. When the interview's result or score differs from what the last release carried, the section warns staff to send the corrected result. The warning never blocks a send, and a correction that ends where the release was raises none.

**Next action**:
A required selection from a fixed list that tells the parent or guardian what to do after receiving the interview result. It is included in the prepared Swahili result message.

The initial choices are **Complete enrollment** and **Contact the admissions office**.

The system restricts the next action automatically: **Passed** leads to **Complete enrollment**, while **Failed** leads to **Contact the admissions office**.

**School fee**:
The annual fee a student owes for their **Enrollment year**, taken from the **Fee schedule** for their class and **Day or boarding** choice, less any **School-fee discount**. It is paid in three instalments: 40%, 40% and 20% of the discounted fee, each with its due date. This is separate from the interview fee.

**Fee schedule**:
The school's fees for one **Enrollment year**. It groups the classes into fee bands (Nursery: **DAY CARE**, **KG 1**, **KG 2**; Primary: **STD 1** to **STD 4**; Primary: **STD 5** to **STD 7**; Secondary: **FORM 1** to **FORM 4**), gives each band a Day and a Boarding annual fee, and holds the instalment split and due dates, the minimum **Initial deposit**, and the **Pre-Form One programme** fee. The Accountant maintains the amounts. The Admissions Manager sets the year's **Academic-year start** and the number of seats in each class, separately for day and boarding. A new year's fees are added as a new schedule; a lead always uses the schedule of its own enrollment year.

**Day or boarding**:
Whether the student will be a day scholar or a boarder. Every lead records it; the **Admission form** and staff registration both ask it, and staff may correct it.

**School-fee payment**:
Money the Accountant records against a student's **School fee**, with its amount, payment type, payment date, and the accountant who entered it. The payment types are **Full payment**, **Initial deposit**, **First instalment**, **Second instalment** and **Third instalment**, plus **Fee waived**, which carries no amount and may be recorded only while the lead has an approved 100% **School-fee discount**. Every other payment is above zero. School-fee payments may be recorded only for a lead whose current interview result is **Passed**, or a reopened lead the Admissions Manager approved to enrol without a retaken interview.

**Initial deposit**:
An advance a parent or guardian pays, at least the schedule's minimum, to hold the child's place before paying the first instalment. It counts toward the **School fee**. Refunding a deposit is outside the system.

**Seat priority**:
A badge on a lead, derived from **Total paid** against its **School fee**: **Full** when the fee is fully paid or waived, **First instalment** when at least 40% is paid, and **Deposit** when at least the minimum **Initial deposit** is paid. A lead with less has no priority. It is never chosen by hand, and it follows the amounts, not the payment types: a deposit that reaches 40% of the fee counts as the first instalment. Every lead with a priority takes a seat in its class, year and day or boarding choice. When a class has more such leads than seats, the system warns the Accountant on recording a lead's first payment, and shows the Admissions Manager the leads ranked **Full**, then **First instalment**, then **Deposit**, then by the date each reached its priority, so the Manager decides who keeps a place. The Manager releases a seat by marking a lead **Declined** with **No seat available**; only staff who may set the seats (`academic_years.manage`) may use that reason, and nothing else frees a seat. Approving a **Reopening request** for a lead that would take a seat in a full class shows the approver the same warning and ranking before they decide.

**Academic-year start**:
The date the school year of an **Enrollment year** begins, in January, set by the Admissions Manager.

**Enrolled** is derived from **Seat priority**; staff cannot select it. A lead becomes **Enrolled** as soon as its priority is **Full**. From the **Academic-year start**, a lead whose priority is **First instalment** also becomes **Enrolled**, automatically on that date for leads already there. A **Deposit** lead is not enrolled until it reaches **First instalment**, and a family that does not get there may be **Declined** with **Fee payment not completed**. A lead with no payment is never **Enrolled**. The system records what triggered **Enrolled**: the payment that brought the lead to the required priority, or the academic-year start.

**Enrolled** is recomputed whenever **Total paid** or the **School fee** changes. A correction that drops a lead below the required priority returns it to the status it held before **Enrolled**; a discount that lowers the fee may enrol it. The lead history records the cause.

**School-fee discount**:
A reduction of the annual **School fee**: **Sibling** 10%, **Staff child** 25%, or **Qualified orphan** 100%. A lead has at most one; when more than one applies, the largest is used. **Sibling** applies automatically to a child whose **Family** already has another child **Enrolled**. It enters the fee as soon as that is true, so it counts toward the child's own **Seat priority**, and it stays once the child is **Enrolled** even if the sibling later leaves the Family's enrolled children. Only a confirmed Family counts; staff may also tick **Has a sibling already at Al-Rahmah** with the sibling's name and class, for a sibling from before the system. **Staff child** and **Qualified orphan** are requested by admissions staff with a note and granted only by the Admissions Manager; supporting documents are checked outside the system. No discount applies to the **Pre-Form One programme** fee, and the **Discount code** never affects school fees.

**Pre-Form One programme**:
A preparatory programme offered to students admitted to **FORM 1**, before Form 1 begins. It is not a class: staff tick it on a **FORM 1** lead when the family takes it up. It has its own fee in the **Fee schedule** for day and boarding, recorded as a separate **Pre-Form One fee** payment that counts toward neither the **School fee**, **Seat priority** nor **Enrolled**.

School-fee payments cannot be deleted. A correction creates a separate adjustment record while preserving the original payment entry and its audit history.

Any accountant may create a payment adjustment; the adjustment is not restricted to the accountant who entered the original payment.

Original payment entries are locked after recording. Corrections must be made through adjustment records rather than direct edits.

**Payment adjustment**:
A correction to one school-fee payment, stating what that payment should have said: its corrected amount, payment type and payment date, or that it is void when the reason is **Duplicate entry**. It carries a reason from the fixed list and an optional note. A payment's effective values are those of its latest adjustment; the original entry and every adjustment remain visible. A wrong adjustment is corrected by another adjustment to the same payment, never by adjusting the adjustment or reversing it, and a voided payment is restored the same way with **Data-entry correction**.

An adjustment changes **Total paid**, so **Seat priority** and **Enrolled** are recomputed after it, and the lead history records that the adjustment caused any change.

**Total paid**:
The sum of a lead's effective school-fee payments. The lead shows its **School fee** (naming any discount), **Total paid**, the balance, and the three instalments with their amounts and due dates. The instalments are for reference: the system sends no fee reminders.

## Roles

**Staff member**:
A person with an account on the staff side of the system. Every staff member holds exactly one **Role**. A staff member joins by **Invite**: the Super Admin, or someone whose role manages that role, enters their name and email into it, and they are **Invited** until they open the email and set a password. An invite can be resent while they are Invited. It can't go to an email any staff member or **Marketing Agent** already uses, and the inviter learns who holds that email only when they manage that person; otherwise they are told only that it is already in use at Al-Rahmah. A staff member who has forgotten their password asks for a reset link at `/login/forgot-password`, the Super Admin included; one still Invited gets a fresh invite there instead, and a Deactivated one gets nothing, with the same reply in every case. Once they have joined, whoever manages them can also **Send reset link** from Staff and roles; every such send is recorded in the audit history. A staff member who leaves is **Deactivated**, never deleted: they lose access, their name stays on everything they recorded, and they may be reactivated later.

**Role**:
A named set of **Permissions** held by staff members, with a **Managed set**. Roles are data the **Super Admin** makes and changes; nobody else creates a role, renames one, changes its permissions or managed set, or retires or reactivates it. Apart from the Super Admin's own role, no role exists until the Super Admin makes it. The quick way is a **Role template**. Nobody may change their own role or deactivate their own account. Whoever moves or deactivates someone who manages staff confirms it first, and the affected person is told at their next sign-in. A role still held by an active staff member cannot be retired; deactivated staff members do not count as holding it. A retired role can be reactivated. A deactivated staff member whose role has been retired must be given a current role before they can be reactivated.

**Role template**:
A starting point the Super Admin creates a role from in one step: a name, a set of permissions and a managed set. The role it makes is ordinary role data, edited like any other. The templates are **Admissions Staff**; **Admissions Manager**, managing Admissions Staff; **Accountant**; **Head Accountant**, managing Accountants; and **Administrator**, managing Admissions Managers and Head Accountants. A new role from a template manages the current roles its template names, and joins the managed set of every current role whose template manages it, so the order the roles are made in does not matter. Matching goes by role name, so a renamed role is not matched.

**Managed set**:
The roles whose staff a role's holders manage: they may invite people into those roles, resend an invite, send a reset link to anyone who has joined, deactivate, reactivate and correct the name of anyone holding one, and move people between roles in the set. Anything outside the set is refused, and so is every change to roles themselves. A role with an empty managed set manages nobody and does not see **Staff and roles**. A role with one sees the people in its managed set and reads every role's name and permissions, with no control to change them. An "administrator" is just a role whose managed set holds managerial roles; it manages people, never roles, and does not read the audit history. The managed set limits what its holders may change, not what they may learn exists: they may be told an email is already in use, but the name, role and kind of whoever holds it stay hidden unless they can already see that person.

**Super Admin**:
The one role that exists only through a reviewed change to the system, never as data a person edits. It holds every permission, including any added later, alone creates and changes every other role, manages every staff member, and alone reads the audit history. It never appears on Staff and roles, in any role list or count, or among the people listed there; its holder's name shows only where they acted. It has one holder, created with it: the school's own account, which starts the system after the hosted reset and invites everyone else. Nobody can rename, retire or change the role, put it in a managed set, move anyone into or out of it, or deactivate its holder.

**Permission**:
A single capability in the system, such as recording a school-fee payment or approving a Marketing Agent. Permissions are fixed by the system; roles only choose among them.

The permissions are:

| Permission | Allows |
|---|---|
| `leads.view` | Finding and reading leads, the date each lead's status last changed, the dashboard, and the follow-up queue. |
| `leads.create` | Entering a new lead. A lead matching an existing record becomes a reopening request instead. |
| `leads.edit` | Correcting a lead's details, parent/guardian contacts, class, enrollment year, day or boarding, **Pre-Form One programme** and referral code, requesting a **Staff child** or **Qualified orphan** discount, reviewing re-applications, and sending the admissions WhatsApp group invitation. |
| `visits.record` | Recording a campus visit. |
| `interviews.record` | Registering a lead for interview and recording its result and score, including editing a recorded result or score. |
| `interview_payments.record` | Marking the interview fee **Paid** or **Not Paid**. |
| `results.send` | Releasing an interview result through **Send through WhatsApp** or the copied **Send SMS** text. |
| `follow_ups.record` | Adding follow-ups and completing them. |
| `leads.decline` | Marking a lead **Declined** with a **Declined reason**. The reason **No seat available** also needs `academic_years.manage`. |
| `leads.close` | Marking a record **Inactive** or **Archived**. |
| `reopenings.approve` | Approving or rejecting a reopening request. |
| `lifecycle.intervene` | Correcting or advancing a lead outside the normal lifecycle sequence. |
| `agents.approve` | Approving a Marketing Agent's **Pending** **Referral code**. |
| `payments.view` | Seeing school-fee payments and payment adjustments. |
| `payments.record` | Recording school-fee payments and payment adjustments, and maintaining the fee amounts in the **Fee schedule**. |
| `discounts.approve` | Granting or refusing a **Staff child** or **Qualified orphan** discount. |
| `academic_years.manage` | Setting the **Academic-year start** and the seats in each class, and releasing a seat with **No seat available**. |
| `group_links.manage` | Saving or replacing the admissions WhatsApp group link for an Enrollment year. |
| `reports.view` | Opening **Reports**, the lead and seat statistics. Every count is answered under `leads.view`, so `reports.view` implies it: a role given `reports.view` gets `leads.view` with it, and a role that loses `leads.view` loses `reports.view` too. Seats by class still needs `payments.view`. |
| `discount_codes.manage` | Setting the **Standard discount** and each Marketing Agent's own interview discount, and creating, editing, pausing, resuming and ending **Promo codes**. Needs `leads.view`. |
| `leads.import` | Importing applicants from a CSV. Needs `leads.create`. |
| `leads.export` | Exporting applicants with their parents' names and phone numbers. Needs `leads.view`. |
| `audit.view` | Reading the audit history: every lead's History page, the Staff and roles history and the system-wide **Audit** screen. Held only by the **Super Admin**; no role may be given it. |

No role holds `reports.view`, `discount_codes.manage` or `leads.export` without `leads.view`, or `leads.import` without `leads.create`. The database keeps each pair together on every write and records the implied change in the same audit entry as the role change.

Recording and editing an interview are one permission: the same people do both, and the audit history keeps every earlier value. Approving an agent and approving a reopening are separate, so a role can approve agents without any power over leads.

The templates hold these permissions. Head Accountant has the Accountant's plus `reports.view`; Administrator has `leads.view`, `payments.view` and `reports.view` only.

| Permission | Admissions Staff | Admissions Manager | Accountant |
|---|:-:|:-:|:-:|
| `leads.view` | ✓ | ✓ | ✓ |
| `leads.create` | ✓ | ✓ | |
| `leads.edit` | ✓ | ✓ | |
| `visits.record` | ✓ | ✓ | |
| `interviews.record` | ✓ | ✓ | |
| `interview_payments.record` | | | ✓ |
| `results.send` | ✓ | ✓ | |
| `follow_ups.record` | ✓ | ✓ | |
| `leads.decline` | ✓ | ✓ | |
| `leads.close` | ✓ | ✓ | |
| `reopenings.approve` | | ✓ | |
| `lifecycle.intervene` | | ✓ | |
| `agents.approve` | | ✓ | |
| `payments.view` | ✓ | ✓ | ✓ |
| `payments.record` | | | ✓ |
| `discounts.approve` | | ✓ | |
| `academic_years.manage` | | ✓ | |
| `group_links.manage` | ✓ | ✓ | |
| `reports.view` | | ✓ | |

**Audit history**:
Every change and action the system records is visible, event by event, to the **Super Admin** alone. Everyone else keeps only the facts their screen needs: a lead's current status and the date it last changed, who declined a lead and why, who marked it Inactive or Archived and why, the newest result release, an agent's "Retired by [name] on [date]", and the notice of a change someone made to their own role or account.

**Admissions Staff** may create and update leads, record visits, record interviews, add follow-ups, mark leads **Declined**, and send interview results. They see school-fee payments but may not record them, mark the interview fee paid, reopen leads, or perform lifecycle interventions.

Admissions Staff may edit interview results and percentage scores directly. Every edit preserves the previous value, the new value, the staff member who made the edit, and the audit history.

**Admissions Manager** has the Admissions Staff capabilities and may approve lead reopening, approve Marketing Agents, and perform authorized lifecycle interventions. They grant **Staff child** and **Qualified orphan** discounts and set each year's **Academic-year start** and class seats. The Admissions Manager template also manages the Admissions Staff: inviting, deactivating and reactivating them. Roles themselves are the Super Admin's.

**Accountant** records school-fee payments and payment adjustments, maintains the fee amounts, and marks the interview fee **Paid** or **Not Paid**. School-fee payment records are the source of the system-derived **Enrolled** status. The Accountant reads leads to find the student being paid for, but does not change them.

**Admissions WhatsApp group links**:
Staff with `leads.view` read each Enrollment year's saved link, who set it and when, under WhatsApp groups. Staff with `group_links.manage` save or replace it. Only `https://chat.whatsapp.com/` invite links are accepted. A year need not have a Fee schedule. Replacing a link affects only new invitations; earlier families still hold the earlier link. Links cannot be deleted, and every change is audited in the lead scope. The migration grants the permission to every non-retired role holding `leads.edit`; roles created later must be granted it explicitly.

**Admissions WhatsApp group invitation**:
From **Visited** onward, staff with `leads.edit` send the owner's fixed Swahili invitation for the lead's Enrollment year, carrying that year's group link, from the lead's screen. It goes by WhatsApp to the parent's WhatsApp number, else their direct phone (Tanzanian mobiles only); with neither, staff copy it and send it themselves. Declined, Inactive and Archived leads offer no invitation, and a reopened lead offers it again. Each send is a permanent record holding the year, the exact link, the message version, the channel, the other children of the confirmed **Family** in the same Enrollment year at that moment, and who sent it and when. A send says the message left the school, never that the family received it or joined. Every child the invitation covered shows it, and shows "sent with an earlier link" once the year's link has been replaced, until it is sent again with the current one. The count of families invited counts parent or guardian contacts, not group members.

**Audit history**:
The preserved record of changes to admissions data. Every edit records the previous value, the new value, the user who made the change, and the change history. This applies across student details, parent/guardian contacts, class, enrollment year, referral code, interviews, follow-ups, lifecycle status, and payments.

The history also records **Action events**: things staff do that change no record, such as sending a staff invite or releasing an interview result. A change is made by a staff member, by the **Admission form**, or by the workbook import, and the history says which. An attempt the system refused is not part of the history, because it changed nothing. How this is stored is in `docs/adr/0004-audit-history-is-one-trigger-fed-log.md`.

**Sign-in notice**:
A message on the staff home telling a staff member that someone else changed their role, deactivated them or reactivated them, with who did it and on which date. It stays until they dismiss it. Changes they made themselves and corrections to their name produce none.

Admissions records are never deleted. A record may be marked **Inactive** or **Archived** when it is no longer operationally active, while remaining permanently available with its complete audit history.

**Inactive** means temporarily not active and potentially eligible to return to active work. **Archived** means permanently closed for normal operations while remaining available for historical reference. **Inactive** and **Archived** are closure marks, not lifecycle statuses: a lead keeps its status while it carries one.

A **Declined**, **Inactive** or **Archived** lead is read-only. Staff can find and read it, and the only action it offers is a **Reopening request**; follow-ups and school-fee payments wait until a reopening is approved. The one exception is a **Payment adjustment**, which corrects history rather than continuing work; a closed lead keeps its closure mark even if an adjustment changes its status.

When any staff member enters a new lead, the system checks for an existing **Inactive** or **Archived** record with matching student name and parent/guardian details. It prevents a duplicate record and prompts staff to reopen the existing lead instead.

The reopening prompt submits an approval request to the Admissions Manager. The matched record is not reactivated until the Admissions Manager approves the request.

If the Admissions Manager rejects the reopening request, the system continues to block creation of a duplicate lead. The existing record remains the sole record for that matching student and parent/guardian combination.

**Reopening request**:
A staff member's request to bring a **Declined**, **Inactive** or **Archived** lead back into active work. It is raised from a duplicate match, from the **Reopen** route on the lead, or from reviewing a **Re-application**; the **Admission form** never raises one by itself. The requester must write why the family is back.

A request is **Pending** until it becomes **Approved**, **Rejected** or **Withdrawn**. Only the staff member who raised it may withdraw it, and only while it is **Pending**. A lead has at most one **Pending** request; anyone else who reaches the same lead sees who raised it and when. A rejection needs a written reason, which the requester sees on the lead. After a rejection or withdrawal a new request may be raised; every earlier request stays in the lead's history. An Admissions Manager may approve a request they raised themselves.

Pending requests wait in a **Reopening requests** queue, oldest first, visible with a count to staff who may approve them. Nobody is notified outside the system; the requester sees the outcome on the lead.

Approval reopens the lead fully: a **Declined** lead returns to the status it held before it was declined, except that **Enrolled** is never restored directly but recomputed from the lead's payments at that moment, and an **Inactive** or **Archived** mark is cleared without changing the status.

When an **Admission form** names a child who matches an existing lead, the form accepts it blindly: the parent or guardian sees exactly the same confirmation as for any other child, including the lead's **Admission Number**, and nothing shows that a match happened. No second lead is ever created for the same child. The submission is recorded on the existing lead as a **Re-application**, and the lead is flagged **Returning family**. A re-application never changes the lead's current details or status: the submitted details, any that differ from the stored ones, and any discount code are kept on the re-application for staff to review, and a **Declined**, **Inactive** or **Archived** lead still needs Admissions Manager approval to reopen. Other, unmatched children on the same form become new **Applied** leads as usual.

Duplicate matching uses the student name and parent/guardian phone number as the primary identity signals. Matching normalizes capitalization and phone-number formatting before comparing records. This check runs whenever a lead is created, even after a **Family** match at the front desk, and blocks the duplicate.

**Family**:
The leads that share a parent/guardian contact, such as siblings. A parent or guardian is matched to an existing Family by phone number alone, normalized and compared against both direct and WhatsApp numbers; names are not compared. At the front desk, staff confirm the parent is the same person before the child joins the Family. A child submitted through the **Admission form** whose parent matches joins the Family unconfirmed, with nothing shown to the parent; staff confirm or reject the match when they review the lead, and an unconfirmed match grants no **Sibling** discount. Staff may also separate a lead from a Family it was wrongly joined to, and the change is audited.

**Returning family**:
The flag on a lead whose parent or guardian already had a lead on record when it was created or re-applied for. It covers both a sibling joining a known **Family** and a **Re-application** for the same child, and tells staff to expect a family the school already knows.

**Front-desk check-in**:
How admissions staff receive a family on campus. Staff first ask for an **Admission Number**. If the family has one, staff enter it and go straight to that lead; a number that matches nothing says so and offers to try again or start a **New Student**. If the family has none, staff start a **New Student**: they enter the parent or guardian first, and if the parent matches a **Family** and staff confirm it is the same person, the system shows that Family's children. A child already listed is not entered again: an active lead opens as it is, and a **Declined**, **Inactive** or **Archived** lead leads to a **Reopening request**. A child not listed is a new sibling and staff continue the registration. Staff never need to search before starting a registration.

**Lead search**:
Searching by exact **Admission Number** always finds the lead, whatever its status or closure mark. Searching by name also returns **Declined**, **Inactive** and **Archived** leads, marked as such and listed after active ones. The lead list without a search term shows active leads only, with a filter for **Inactive**, **Archived** or all leads.

## Reporting

The dashboard reports **Visited leads** and **Interviewed leads**, each filterable by date, week, month, and year. It also reports **Passed interviews**, **Failed interviews**, **Enrolled students**, and **Leads by enrollment class**.

All dashboard metrics show overall totals by default. Each metric provides a filter icon and a simple dropdown allowing the user to choose a date, week, month, or year reporting period.

**Leads by enrollment class** shows the number of leads in each fixed class for the selected reporting period.

The reporting period says when something happened, in calendar terms and Tanzania time; a week starts on Monday. Each metric counts by its own date: **Visited leads** by **Visit date**, **Interviewed leads**, **Passed interviews** and **Failed interviews** by interview date, **Enrolled students** by the date **Enrolled** was triggered, and **Leads by enrollment class** by the date the lead was created. A separate **Enrollment year** filter on every metric says which intake is counted, because one intake's visits run into the next's.

**Interviewed leads** counts children: a child who sat a retaken interview in the same period counts once. **Passed interviews** and **Failed interviews** count sittings, so a retake counts as an interview of its own. An interview counts only once its result is recorded, and whether its fee is paid makes no difference.

**Enrolled students** counts the leads that are **Enrolled** now, by the date **Enrolled** was triggered as the lead's School fee records it. A lead that went back below the line through a payment adjustment or a fee change, or was **Declined** after it was Enrolled, is left out. An Enrolled lead marked **Inactive** or **Archived** still counts, since a closure mark isn't a status. A lead enrolled on the **Academic-year start** counts on the start date, and an adjustment that moves the trigger date moves the lead to that date's period.

Every panel opens on **All time** and **All years**, and each panel keeps its own filters, so two panels can show different periods side by side. The **Enrollment year** filter always uses the lead's current enrollment year, so one child counts in one intake on every panel.

Only **Enrolled students** depends on a lead's current status. The other metrics count what happened, whatever the lead's status or closure mark is now: a lead that visited and was later **Declined** or marked **Archived** still counts in **Visited leads**.

Counts follow corrected values. A corrected **Visit date**, interview date, result, class or enrollment year moves the lead to the corrected count or period; the lead's history keeps the old value, and the dashboard does not rebuild past counts from it.

**Seats by class** shows, for each class and **Enrollment year**, the seats taken against the seats available, split by **Seat priority** and by day and boarding.

**Seats by class** is a snapshot of the seats as they stand now, so it has only an **Enrollment year** filter and no period. It opens on the latest year with a Fee schedule and offers the other years that have one. It shows counts, never the leads holding the seats, and only to staff who may view payments.

The system provides a dedicated follow-up queue containing leads with upcoming or overdue follow-ups.

The queue is divided into **Overdue** and **Upcoming** sections. Overdue follow-ups are ordered oldest first; upcoming follow-ups are ordered by the nearest scheduled date.

Completing a follow-up normally requires scheduling the next follow-up date. Every **Declined** lead is a final closed state, so staff may close its final follow-up without scheduling another date. The final status and reason remain part of the lead history.

After an approved reopening, a new follow-up date is required unless the lead proceeds directly to **Enrolled** through a qualifying accountant-recorded school-fee payment.

Every lead that was previously **Declined** retains the automatic **Initially declined** tag after reopening, including when it retakes the interview before enrolling.

Admissions Staff and the Admissions Manager may mark admissions records **Inactive** or **Archived**.

Marking a record **Inactive** or **Archived** requires a reason selected from a fixed list and records the staff member and date of the action.

The initial reasons are **Duplicate record**, **Family requested closure**, **Enrolled elsewhere**, **No longer pursuing admission**, **Record created in error**, and **Admission cycle ended**.

Every payment adjustment requires a reason selected from a fixed list explaining the correction.

The fixed adjustment reasons are **Wrong amount**, **Wrong payment type**, **Wrong payment date**, **Duplicate entry**, and **Data-entry correction**. No general **Other** option is available.

**Interview result**:
The outcome of an admission interview. It must be either **Passed** or **Failed**.

**Interview score**:
The required score assigned to every lead with **Interviewed** status. It is recorded as a percentage alongside the interview result.

The score runs from 0 to 100 and allows one decimal place, such as 72.5. A finer score is refused rather than rounded, so a typing mistake is never saved as something else. The interview date, result and score are recorded together, never one without the others.

**Marketing Agent**:
A person who refers families to Al-Rahmah, most often one of the school's own teachers. Anyone may register as a Marketing Agent. The agent is recorded on a lead through its **Referral code** and is never an internal follow-up owner. An **Approved** agent who is switched on and has a confirmed email may have a login of their own, kept apart from staff logins: it reaches no staff screen, function or record, and agents change nothing in the system; they may change only their own sign-in email, in Supabase Auth (see **Agent invite**). They join through an **Agent invite** and sign in on the same sign-in page as staff, `/login`, which sends them to their students; a read-only list of the students who used their code is being built, and commission and its settlement come later.
An agent registers with their full name, a phone number and, when it differs, a WhatsApp number. One phone number holds one agent: registering again with the same number gives back the same agent and code. The agent list is open to staff who may view leads (`leads.view`).
The Admissions Manager may also add an agent directly (`agents.approve`), with a full name, a required mobile, an optional WhatsApp number, an optional email and the agent's existing code if they already have one. The Manager checks the details as they will be saved first. A Manager-added agent starts **Approved**, and an email given there counts as confirmed by the Manager. A mobile a current agent already uses adds nothing and names that agent; so does a code a current agent holds. Registration, the Manager's add and **Recreate** all create agents the same way, and a new code never repeats one any record has held or one already on a lead. An email belongs to one login, staff or agent: adding an agent refuses an email a staff member or a current agent uses, and inviting staff refuses one a current agent uses. Either is refused an email another person's login already uses. A staff email is unique across every staff record; an agent email is unique among agent records that aren't retired.
The Manager can also import existing agents from a CSV (`agents.approve`), keeping their codes. A check screen sorts every row before anything is saved: to create, already present (the code and name match, ignoring case and extra spaces), email to add, email or mobile differs (left unchanged), flagged as a number Excel changed, or refused with its reason. Confirming saves every row to create and every email to add, or nothing. Imported agents start **Approved**, an imported email counts as confirmed by the Manager, and the import sends no email. Each import is recorded as an **Import batch**: its kind, file name, who ran it, when and its counts. The Agents list can show the agents one batch created.
_Avoid_: External referral agent, referrer, staff owner, follow-up staff

**Agent approval**:
A newly registered Marketing Agent's **Referral code** is **Pending** until the Admissions Manager approves it, after which it is **Approved**. Only an **Approved** code grants the interview discount. Approving an agent with an email sends them an **Agent invite** to the email the Manager saw in the approval dialog; an agent with no email is told by staff themselves, outside the system.
Approval is one-way: nothing returns an **Approved** agent to **Pending**. Approving needs only `agents.approve`, with no lead permission.

**Agent invite**:
The email that lets an **Approved**, switched-on agent set a password, sent by the Admissions Manager (`agents.approve`) with **Send invite**, or **Resend** once an invite has gone to that email, and on approval. It goes only to the email shown on the Manager's screen, and only while **Agent access** is on. The link opens the set-password page under the Discount code path, works once and expires after 24 hours; after setting a password the agent lands on their students, and later signs in on `/login`. An agent who has forgotten their password asks for a reset link at `/login/forgot-password`. Every attempt is recorded with its result: sent, rate-limited, email service error, address refused, other error (with its code) or agent access off. "Sent" means the email service accepted it, never that it arrived. Approval stands whatever the email does: the Manager sees "Approved. Invite not sent: [reason]" and can resend. Before the agent joins, the Manager may add or correct the email, which stops any link sent to the old address; the next invite goes to the new one. Once the agent has joined, their email is their sign-in and lives in Supabase Auth only: the Manager can no longer edit it ("Only the agent can change this now"), and the Agents screen shows the address read from Auth. The agent may change it themselves through Auth's change-email flow, confirmed from both the old and the new inbox, so they keep access if they lose the old one. Their Discount code, name and the rest of their record never change this way. Each send records its result against the attempt that checked the agent before sending, to the address it went to, even if the agent is switched off or retired while it goes out.
A browser holds one account at a time. `/login` sends a browser that is already signed in to its own side: staff to the staff side, an agent to their students. Every password reset link, staff's and agents', opens one reset page in the sign-in card, `/login/reset-password`, which lands each person on their own side once the new password is saved; an older agent link to `/discount-code/reset-password` is sent there. While a browser is signed in to any account, that page asks to sign out first. While a browser is signed in as staff, the agent's set-password page refuses to use the link, with "Kivinjari hiki kimeingia kama mfanyakazi. Toka kwanza." ("This browser is signed in as staff. Sign out first.") and a sign-out button, and the staff invite page refuses the same way while an agent is signed in. The link stays unused until the right account uses it.

**Invite batch**:
From "Approved, no account yet" on the Agents screen, the Admissions Manager sends **Agent invites** in a batch with **Send invites**, to every agent the list shows or to one import's agents. A batch goes to agents in **Invite not sent** or **Invited, link expired**, oldest approval first, one at a time. It skips anyone invited in the last 24 hours and anyone with **No email**. It sends at most 30, below the hourly email limit, and stops early at the first of: the hourly email limit (the email service refusing with a rate limit), the time one batch may take, or the **daily budget**. The daily budget is the email service's daily cap less a reserve kept for staff invites, less the agent invite emails already sent that day; both numbers are configuration, not code, and the day is the email service's, starting at 03:00 East Africa Time. Each attempt is recorded as it finishes. The batch's report reads "sent X, waiting Y, no email Z, failed W", with its times in East Africa Time, and says why it stopped, keeping the hourly limit and the daily budget apart. Each count opens the agents behind it. **Waiting** is the agents on the batch's list who still need an invite, including those it didn't reach and those the rate limit stopped; **Failed** is those whose send the email service or Auth refused. The report is read from the records every time, so a batch cut off before it finished still adds up.

**Account state**:
Where an agent stands with their login, one per agent, shown as a badge on the Agents screen. The first that applies, in this order, except that an agent who has joined is **Joined** whatever their invites say:
1. **Retired**.
2. **Switched off**.
3. **Awaiting email confirmation**: the agent has no email and an **Email claim** waits for the Manager to confirm it. This one also applies to a Pending agent.
4. **No email**.
5. **Invite not sent**: no invite has gone to the current email.
6. **Invited, link expired**: the latest invite to the current email is more than 24 hours old.
7. **Invited**: shown as "Invite sent".
8. **Joined**: the agent has used their invite link and saved a password. An agent whose link was used but whose password wasn't saved is still **Invited** (or **Invited, link expired**), and a **Resend** replaces their unfinished login.

A **Pending** agent has no account state other than **Awaiting email confirmation**; approval comes first. The Agents screen filters and counts **Awaiting email confirmation** (shown as the claim queue), "Approved, no account yet" (every Approved agent not retired, switched off or **Joined**), **Invite not sent** and **Invited, link expired**, and shows "Needs attention" beside the Pending count: the sum of **Awaiting email confirmation**, **Invite not sent** and **Invited, link expired**, with the breakdown. Agents are never labelled "Inactive". A switched-off or retired agent who signs in sees "Huwezi kuingia kwa sasa. Piga simu ofisini." ("You can't sign in right now. Call the office."), with the reason code `switched_off` or `retired`.

**Email claim**:
An email typed on the Discount code page by someone who ticked "Tayari una code?" ("Already have a Discount code?") and gave a code and mobile that both belong to one current agent with no email. It never touches the agent's record until the Admissions Manager phones the agent and decides it in the **Awaiting email confirmation** queue: **Confirm** saves the claimed email and sends the invite, **Save and send invite** saves a corrected one and sends it, and **Reject** leaves the record without an email. Confirming one claim rejects the agent's other waiting claims. A second claim on the same agent with another email is a competing attempt, shown beside the first. Claims are kept for good, with who decided and when. A stored email is never replaced by a claim, and once the agent has joined only they change their email. The page answers every case with its own message, in this order: agent access off; with the box ticked, no current switched-on agent holds the code ("Hatukupata code hii. Ihakiki, au piga simu ofisini."), the code's agent has another mobile ("Hatukuweza kulinganisha code na namba hii. Zihakiki, au piga simu ofisini."), the agent has joined ("Tayari una akaunti. Ingia."), was sent an invite ("Tumekutumia barua pepe. Angalia spam, au tumia 'Tuma kiungo kipya'."), already has an email or a waiting claim ("Tumepokea ombi lako; shule itathibitisha."), or the claim is recorded and the page shows the code; with the box unticked, a mobile that already has a code is told to tick the box, and otherwise a new Pending agent is created with the email. An email staff, another agent or another login uses gets "Barua pepe hii haiwezi kutumika. Tumia nyingine au piga simu ofisini." A code typed with the box unticked is used for the new agent only if no record ever held it and no student carries it; otherwise it is kept beside the record and flagged on the Agents screen.

**Switched off**:
A Marketing Agent the Admissions Manager has stopped for now, such as one who has left the school. A switched-off agent's code gives no discount on any interview fee not yet Paid, whatever their approval; fees already Paid keep the amount locked when they were marked. Switching the agent back on restores the discount on every fee still not Paid. The Admission form tells the family "Code hii haitoi punguzo kwa sasa. Unaweza kutuma fomu." ("This code gives no discount at the moment. You can still send the form."), and the form can still be sent with the code.

**Retired** (agent record):
A Marketing Agent record the Admissions Manager has closed for good, usually because it was created wrongly. It stays for history, gives no discount and never changes again. Its phone and email are freed so the agent can be created again correctly, any login is detached and closed for good, and its code comes back only through **Recreate**. Retired records are hidden from the Agents screen except under its Retired filter, and never count towards the Pending count.

**Agent access**:
One setting for the whole system that turns every agent path on or off at once: sign-up, claiming a code, sign-in, invites, password resets and the agent's own pages. It is off until go-live and is the instant rollback. It never changes a fee. The Agents screen shows whether it is on and who last changed it; while it is off, agents see "Huduma hii imesimamishwa kwa muda." ("This service is paused for now.") with the reason code `access_off`, so staff can tell it apart from a **Switched off** agent. The one exception is `/login/forgot-password`, which staff use too: there an agent's email gets the same reply as any other, and no email.

**Recreate**:
The Admissions Manager's correction of a wrong agent record: in one step, the record is retired (or, if it was already retired and no current agent holds its code, its recreation is recorded) and a corrected record is created holding the same code, **Approved** and switched on, so families never lose the discount. The Manager first sees how many students carry the code and confirms it is the same person. The students follow the code to the new record, any login moves with it, and the change records both records, the code, the student count and the leads. Adding an agent with a code only a retired record held offers Recreate: "This code belonged to retired record [name]. N students carry it."

Switching off, switching on, retiring and Recreate each need `agents.approve` and a reason. Before the Manager confirms, the Agents screen lists the families whose interview fee the change moves: leads carrying the code whose current interview fee is not yet Paid, closed leads included. It gives staff a Swahili line to read to each of them, and records the number with the change.

**Referral code**:
The code that identifies a Marketing Agent, issued when the agent registers. It is the only referral field on a lead: the agent's name is never entered separately and is resolved from the code. A lead gets its code from a **Referral link**, from the parent or guardian typing it into the **Admission form**, or from staff entering it for a walk-in family. However it arrives, an **Approved** code on the lead is what grants the interview discount. A code typed on the form that matches no Marketing Agent is kept on the lead as **Unrecognised** and grants no discount; staff may correct it to a real code, and the correction is audited.
A code is the initials of the first three words of the agent's name, a hyphen and three digits, such as `AJM-407` (four digits once the three-digit codes for those initials run short). Codes are matched however they are typed: case and spaces never matter.
Staff can only enter a registered agent's code, **Pending** or **Approved**, or a **Promo code** in any state; a code that matches neither is refused. Only the **Admission form** can leave an **Unrecognised** code on a lead.
A code the form sends for a child already on file stays on the **Re-application** and never reaches the lead from the form, so nothing from the public overwrites a checked record. Staff reviewing the re-application see it beside the lead's code, flagged when the two differ, and may apply it to the lead under the same rule as entering a code: only a registered agent's code, and only on an open lead.
_Avoid_: External referral code, Marketing Agent code. Parents and agents see it as a **Discount code**.

**Standard discount**:
The amount an **Approved**, switched-on agent's code takes off the interview fee unless the agent has an own amount: whole shillings from 0 to 50,000, **TZS 10,000** when the system starts. A role with `discount_codes.manage` changes it on the Marketing Agents screen with a reason, after seeing the families whose unpaid fee it moves; the agent registration page quotes it. An agent's own amount is set the same way, and putting the agent back on the standard makes them follow it again.

**Promo code**:
A school code for a campaign or group, such as an Instagram ad or a parents' association, with a name staff see, the code parents type and a whole-shilling amount off the interview fee. It belongs to no Marketing Agent: a lead carrying it has no agent, earns no commission and never shows on an agent's students. The code is 4 to 12 letters and digits with no hyphen, unique across agent codes and Promo codes, and never changes once created. A Promo code is **Active** (gives its amount), **Paused** (gives nothing until resumed), **Ended** (final: it stays in history and on its students, gives nothing and can never be reused), or **Expired** (Active past its optional last day). Creating, editing, pausing, resuming and ending need `discount_codes.manage`; a new amount or last day, and every state change, need a reason. Everyone with `leads.view` sees the list. Parents type it into the same **Discount code** field as an agent's code.
_Avoid_: Coupon, voucher, school code

**Discount code**:
The name used for a **Referral code** wherever parents, guardians or Marketing Agents see it: on the **Admission form**, the agent registration page, and every message or page addressed to them. In Swahili it is **Code ya Punguzo**. Parent-facing text never mentions Marketing Agents, referrals or agent approval: a **Pending** code is described as a discount code awaiting confirmation. The agent registration page tells the agent that families who use their discount code get TZS 10,000 off the interview fee.
While the field holds a code, the **Admission form** shows the code-holder notice under it: the person who gave the family the code will see their child's admission progress. Staff entering a code for a walk-in family see a reminder to tell the family the same. Each lead records which notice went with its code (`form_v1` or `staff_reminder`), as the school's PDPA 2022 evidence; no version means no notice was shown, as for codes from before the notice and imports.
_Avoid_ (in text parents or agents see): Referral code, agent, Wakala, Kodi ya punguzo

**Referral link**:
A shareable link, issued with a Marketing Agent's **Referral code**, that the agent sends to parents. It opens the **Admission form** with the code already filled in. A parent who follows the link and returns to submit the form within 30 days keeps the agent's code. The 30 days count from the latest link followed, and the latest link wins: following a second agent's link replaces the first code and starts the 30 days again.

**Follow-up record**:
A record of contact made with an admissions lead, including a required comment describing what happened, contact method, internal staff member who made that contact, and the date. Every follow-up is preserved as part of the lead's complete history. The staff member is selected when the follow-up occurs; staff are not assigned to the lead in advance.

Each follow-up preserves both the date and time the contact occurred and the date and time the record was entered into the system.

**Follow-up contact method**:
The channel used for a follow-up. The fixed choices are **Phone call**, **WhatsApp**, **SMS**, and **In-person**.

**Visit date**:
The date on which the parent or guardian visited the school campus. This is the lead's primary date and is not the date the record was entered into the system.

**Parent/guardian contact**:
The required full name, relationship to the lead student (one of **Mother**, **Father**, **Guardian**, or **Other** with a short description), and direct phone contact for the parent or guardian who communicates with the school on the student's behalf. The record may also include a separate WhatsApp contact when it differs from the direct phone contact.

A parent or guardian may be associated with multiple student leads, such as siblings. Each student remains a separate lead with its own lifecycle, interview records, payment information, and follow-up history.

Sibling students are interviewed and assessed independently. Each student receives a separate interview registration number, interview result, and percentage score.

**Enrollment year**:
The single calendar year in which the student is planned to enroll, such as **2026** or **2027**. It is selected by staff, or on the **Admission form** from the current calendar year and the next, and must not be represented as an academic-year range.

**Class**:
A fixed school class selected from the current workbook list: **DAY CARE**, **KG 1**, **KG 2**, **STD 1** through **STD 7**, and **FORM 1** through **FORM 4**. Staff cannot create ad hoc class values. The workbook's **PRE-FORM ONE** is not a class: such a student is a **FORM 1** lead on the **Pre-Form One programme**.

Student gender is not part of the admissions-lead information model.

Student date of birth is not part of the admissions-lead information model.

**Interview registration number**:
An automatically incremented number representing the count of current interviews. The system assigns it whenever a lead is registered for an admission interview. It is not the permanent identifier of the lead. Staff call it the **S/N**.

The S/N counts from 1 within the lead's **Enrollment year**, so each intake's interview list starts fresh. Staff registering at the same moment always get different numbers. Once given, an S/N never changes, not even when the lead's enrollment year is corrected afterwards, and it is never given to another registration, even if the lead it belongs to is later closed.

**Lead ID**:
A permanent, system-generated identifier for an admissions lead. It is separate from the interview registration number and remains attached to the lead throughout corrections, follow-up, and status changes. Parents and guardians know it as the **Admission Number** (Swahili: **Namba ya Udahili**): **ADMSN-** followed by five random digits (for example **ADMSN-40719**), the same form for walk-in and applied leads. The digits are random so a number reveals nothing about when or whether a lead existed before. The Admission Number is a lookup key, not proof of identity: staff confirm the parent or guardian in person before discussing a lead. It is issued when the lead is created, on submitting the **Admission form** or a **New Student** registration, never earlier, and is shown on the confirmation. Staff find the lead by it, or by the student's name, when the family arrives.
_Avoid_: Application number, reference number
