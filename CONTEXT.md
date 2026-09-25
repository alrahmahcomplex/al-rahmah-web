# Al-Rahmah Admissions

This context covers the work of capturing and progressing families who are considering admission to Al-Rahmah Schools. It focuses on admissions leads and their journey before enrolment.

## Language

**Admissions lead**:
A student record created in one of two ways: a parent or guardian submits the **Admission form**, and the lead begins as **Applied**; or a family with no submitted form completes a qualifying campus visit, and the lead begins as **Visited**. It may proceed to an admission interview, enrolment, or decline. The parent or guardian is a contact person or custodian associated with the lead, not the lead themselves.
_Avoid_: Parent, guardian, prospect, enquiry, applicant

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

The initial choices are: **Enrolled elsewhere**, **Family changed plans**, **Fees or cost**, **Did not pass interview**, **Unreachable after follow-up**, **School decision**, and **Other**.

**Interview payment**:
The payment status for the admission interview, in Tanzanian shillings (TZS). The standard interview amount is **TZS 50,000**. An **Approved** **Referral code** on the lead grants a **TZS 20,000** discount, making the calculated expected amount **TZS 30,000**. Staff cannot override the calculated fee and record only **Paid** or **Not Paid**; payment date, method, and receipt reference are outside the current scope.

An unpaid interview may still be conducted and its result recorded internally. The interview result must not be released to the parent or guardian until the interview payment status is **Paid**.

Once payment is **Paid**, staff may release the result through a **Send through WhatsApp** action. This action generates a short WhatsApp link containing a predefined message with the interview result and next action. It is an intentional staff-triggered release, not an unsolicited automatic message.

The result message is written in Swahili, uses warm and expressive language, congratulates the family when the result is **Passed**, and responds empathetically when the result is **Failed**. The message is structured for WhatsApp readability using appropriate bold, italics, and bullets.

The prepared result message includes the student's interview result, percentage score, and selected next action.

The WhatsApp action targets the parent/guardian's separate WhatsApp contact when available, otherwise it falls back to the direct phone contact. If no WhatsApp-capable number is available, the action is presented as **Send SMS**; it reveals the prepared message and provides a copy function instead of generating a WhatsApp link.

**Next action**:
A required selection from a fixed list that tells the parent or guardian what to do after receiving the interview result. It is included in the prepared Swahili result message.

The initial choices are **Complete enrollment** and **Contact the admissions office**.

The system restricts the next action automatically: **Passed** leads to **Complete enrollment**, while **Failed** leads to **Contact the admissions office**.

**Enrolled** is reached only when the accountant records an actual school-fee amount paid for the student. The record must identify whether the payment was a full payment, first installment, or initial deposit. Once a qualifying amount exists, the system changes the lead to **Enrolled**; staff cannot select this status manually. This enrollment trigger is separate from the admission interview payment.

The accountant may record multiple school-fee payments over time. The system preserves the first qualifying payment as the event that triggered **Enrolled**, while later payments remain part of the student's payment history.

Each school-fee payment record includes the actual amount paid, payment type, payment date, and the accountant who entered it.

School-fee payments cannot be deleted. A correction creates a separate adjustment record while preserving the original payment entry and its audit history.

Any accountant may create a payment adjustment; the adjustment is not restricted to the accountant who entered the original payment.

Original payment entries are locked after recording. Corrections must be made through adjustment records rather than direct edits.

## Roles

**Staff member**:
A person with an account on the staff side of the system. Every staff member holds exactly one **Role**. A staff member who leaves is **Deactivated**, never deleted: they lose access, their name stays on everything they recorded, and they may be reactivated later.

**Role**:
A named set of **Permissions** held by staff members. The system starts with three roles: **Admissions Manager**, **Admissions Staff**, and **Accountant**. The Admissions Manager may create further roles and change which permissions any role holds, except the role they hold themselves. Nobody may change their own role or deactivate their own account; another staff member able to administer staff must do it. The Admissions Manager role therefore changes only through a reviewed change to the system itself, however many Managers there are. One Manager may change another Manager's role or deactivate them, after confirming the consequence; the affected Manager is told at their next sign-in. The system always keeps at least one active staff member able to administer staff and roles. A role still held by an active staff member cannot be retired; deactivated staff members do not count as holding it. A deactivated staff member whose role has been retired must be given a current role before they can be reactivated.

**Permission**:
A single capability in the system, such as recording a school-fee payment or approving a Marketing Agent. Permissions are fixed by the system; roles only choose among them.

**Admissions Staff** may create and update leads, record visits, record interviews, add follow-ups, mark leads **Declined**, and send interview results. They may not reopen leads, perform lifecycle interventions, or record school-fee payments.

Admissions Staff may edit interview results and percentage scores directly. Every edit preserves the previous value, the new value, the staff member who made the edit, and the audit history.

**Admissions Manager** has the Admissions Staff capabilities and may approve lead reopening, approve Marketing Agents, and perform authorized lifecycle interventions. The Admissions Manager also administers the staff side: adding and removing staff members, assigning each one's role, and defining roles.

**Accountant** records school-fee payments and payment adjustments. School-fee payment records are the source of the system-derived **Enrolled** status.

**Audit history**:
The preserved record of changes to admissions data. Every edit records the previous value, the new value, the user who made the change, and the change history. This applies across student details, parent/guardian contacts, class, enrollment year, referral code, interviews, follow-ups, lifecycle status, and payments.

Admissions records are never deleted. A record may be marked **Inactive** or **Archived** when it is no longer operationally active, while remaining permanently available with its complete audit history.

**Inactive** means temporarily not active and potentially eligible to return to active work. **Archived** means permanently closed for normal operations while remaining available for historical reference.

When any staff member enters a new lead, the system checks for an existing **Inactive** or **Archived** record with matching student name and parent/guardian details. It prevents a duplicate record and prompts staff to reopen the existing lead instead.

The reopening prompt submits an approval request to the Admissions Manager. The matched record is not reactivated until the Admissions Manager approves the request.

If the Admissions Manager rejects the reopening request, the system continues to block creation of a duplicate lead. The existing record remains the sole record for that matching student and parent/guardian combination.

When an **Admission form** names a child who matches an existing lead, no new lead is created for that child. The parent or guardian is shown the existing **Admission Number** and asked to contact the admissions office, and nothing else about the existing record is revealed. The existing lead is flagged **Returning family** for staff, together with any parent or guardian details from the form that differ from the stored ones; a public form never overwrites stored details. Other, unmatched children on the same form become new **Applied** leads as usual.

Duplicate matching uses the student name and parent/guardian phone number as the primary identity signals. Matching normalizes capitalization and phone-number formatting before comparing records.

## Reporting

The dashboard reports **Visited leads** and **Interviewed leads**, each filterable by date, week, month, and year. It also reports **Passed interviews**, **Failed interviews**, **Enrolled students**, and **Leads by enrollment class**.

All dashboard metrics show overall totals by default. Each metric provides a filter icon and a simple dropdown allowing the user to choose a date, week, month, or year reporting period.

**Leads by enrollment class** shows the number of leads in each fixed class for the selected reporting period.

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

**Marketing Agent**:
A person outside the school who refers families to Al-Rahmah. Anyone may register as a Marketing Agent. The agent is recorded on a lead through its **Referral code** and is never an internal follow-up owner. Marketing Agents currently have no account and see nothing in the system after registering; agent-facing tracking of referred leads and commission are planned for later.
_Avoid_: External referral agent, referrer, staff owner, follow-up staff

**Agent approval**:
A newly registered Marketing Agent's **Referral code** is **Pending** until the Admissions Manager approves it, after which it is **Approved**. Only an **Approved** code grants the interview discount.

**Referral code**:
The code that identifies a Marketing Agent, issued when the agent registers. It is the only referral field on a lead: the agent's name is never entered separately and is resolved from the code. A lead gets its code from a **Referral link**, from the parent or guardian typing it into the **Admission form**, or from staff entering it for a walk-in family. However it arrives, an **Approved** code on the lead is what grants the interview discount. A code typed on the form that matches no Marketing Agent is kept on the lead as **Unrecognised** and grants no discount; staff may correct it to a real code, and the correction is audited.
_Avoid_: External referral code, Marketing Agent code. Parents and agents see it as a **Discount code**.

**Discount code**:
The name used for a **Referral code** wherever parents, guardians or Marketing Agents see it: on the **Admission form**, the agent registration page, and every message or page addressed to them. In Swahili it is **Code ya Punguzo**. Parent-facing text never mentions Marketing Agents, referrals or agent approval: a **Pending** code is described as a discount code awaiting confirmation. The agent registration page tells the agent that families who use their discount code get TZS 20,000 off the interview fee.
_Avoid_ (in text parents or agents see): Referral code, agent, Wakala, Kodi ya punguzo

**Referral link**:
A shareable link, issued with a Marketing Agent's **Referral code**, that the agent sends to parents. It opens the **Admission form** with the code already filled in. A parent who follows the link and returns to submit the form within 30 days keeps the agent's code.

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
A fixed school class selected from the current workbook list: **DAY CARE**, **KG 1**, **KG 2**, **PRE-FORM ONE**, **STD 1** through **STD 7**, and **FORM 1** through **FORM 4**. Staff cannot create ad hoc class values.

Student gender is not part of the admissions-lead information model.

Student date of birth is not part of the admissions-lead information model.

**Interview registration number**:
An automatically incremented number representing the count of current interviews. The system assigns it whenever a lead is registered for an admission interview. It is not the permanent identifier of the lead.

**Lead ID**:
A permanent, system-generated identifier for an admissions lead. It is separate from the interview registration number and remains attached to the lead throughout corrections, follow-up, and status changes. Parents and guardians know it as the **Admission Number** (Swahili: **Namba ya Udahili**). Walk-in and applied leads share one numbering. It is shown when the **Admission form** is submitted, and staff find the lead by it, or by the student's name, when the family arrives.
_Avoid_: Application number, reference number
