# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Parents and guardians in Tanzania** are the primary audience of the public side. Most arrive on a phone, from a WhatsApp message, a Marketing Agent's **Referral link**, or a social post. They are deciding whether Al-Rahmah is the right school for their child and, if it is, applying through the **Admission form**. A parent may be applying for more than one child.

**Marketing Agents** are people outside the school who refer families. They register publicly, receive a **Referral code** and **Referral link**, and currently see nothing else in the system.

**Staff** use the Admissions Portal at an office desktop or laptop, often with a family sitting across the desk. There are three starting roles: **Admissions Staff** (leads, visits, interviews, follow-ups, result release), **Admissions Manager** (everything Admissions Staff do, plus approvals, interventions, and staff and role administration) and **Accountant** (school-fee payments and adjustments).

## Product Purpose

One Next.js app, three products:

1. **School Landing Page**: persuades parents that Al-Rahmah is the right school and sends them to the Admission form.
2. **Admissions Portal**: the staff-side system that carries each **Admissions lead** from **Applied** or **Visited** through **Interviewed** to **Enrolled** or **Declined**, with complete audit history. It replaces the `2026-2027 Admissions.xlsx` workbook.
3. **Referral Tracking System**: registers Marketing Agents, issues codes and links, and credits referred leads. Agent-facing tracking and commission come later.

Success means parents apply without friction from a phone, staff never lose a lead or its history, and every referral is traceable to its agent.

## Positioning

Al-Rahmah Complex (Al-Rahmah Schools) offers Islamic values alongside academic results, and one campus takes a child from **Day Care through Form 4**. Beyond the curriculum it runs programs few neighbouring schools can claim:

- a two-year **Leadership Training Program** for selected students;
- a six-month **Ambassadors of Discipline Program** for graduating Form Four students;
- an **ICT Club** with AI and robotics classes;
- **ISO 9001:2015** certification, held since 2023;
- a school bus service for day scholars.

## Operating Context

- Parents read on phones, often on mobile data, and share via WhatsApp.
- A parent who submits the Admission form receives an **Admission Number** (the Lead ID) and brings it to campus; staff find the lead by that number or by the student's name.
- Interview results reach parents only through a staff-triggered **Send through WhatsApp** (or **Send SMS**) action, as a warm Swahili message, and only once the interview fee is **Paid**.
- Money is in Tanzanian shillings (TZS). The interview fee is TZS 50,000, or TZS 30,000 with an **Approved** Referral code.
- Domain terms, lifecycle rules and role permissions are defined in [CONTEXT.md](CONTEXT.md); that file is the authority for vocabulary.

## Capabilities and Constraints

- **Languages**: the public site is bilingual, English and Swahili, with a language switcher. The staff portal is in English. Result messages to parents are in Swahili.
- **Stack**: Next.js App Router, TypeScript, Tailwind v4, shadcn (`base-nova`), Supabase and Vercel, as recorded in [AGENTS.md](AGENTS.md).
- Public pages must stay up when Supabase or staff sign-in is down.
- Admissions records are never deleted, only marked Inactive or Archived. Payments are never edited, only adjusted.
- Class names are fixed: DAY CARE, KG 1, KG 2, STD 1 to STD 7, FORM 1 to FORM 4. Pre-Form One is a programme on a FORM 1 lead, not a class.
- **Open**: the landing page's final section list, the Swahili copy, and whether fees are published on the site.

## Brand Commitments

- Name: **Al-Rahmah Complex**; the schools are **Al-Rahmah Schools**.
- Official logo: `public/Al-Rahmah_Official_Logo.svg`. Official digital palette: `public/Al-Rahmah Color Palette (Digital & Web).svg`.
- Brand source material, read-only: workspace `branding-elements/` (admission and Pre-Form One flyers, business card, palette). The archived repo `alrahmahcomplex/Al-Rahmah_Complex` is a reference for branded styling and sign-in.
- Parent-facing Swahili messages are warm and expressive: congratulatory on a pass, empathetic on a fail.

## Evidence on Hand

The user has confirmed each of these exists. Assets outside the repo must be copied in, optimised, before a page uses them.

- **Campus photos**: workspace `images/` (about 40 photos), real Al-Rahmah campus and students, cleared for public use.
- **Parent testimonials**: recorded videos of parents, plus quotes. Not yet in the workspace.
- **Exam results**: real national exam figures. Not yet supplied.
- **Fees and contact facts**: fee ranges, location, phone and WhatsApp, office hours. Not yet supplied.
- ISO 9001:2015 certification, held since 2023.

Until the user supplies them, no page may invent exam figures, rankings, testimonials, quotes, fee amounts, contact details or enrolment numbers. Use a visible placeholder instead.

`2026-2027 Admissions.xlsx` holds real family records and never feeds the site, fixtures, tests or screenshots.

## Product Principles

1. **Phone first for parents.** Every public page is judged on a mid-range Android phone over mobile data before a desktop.
2. **Proof over promises.** Claims on the landing page rest on real results, real parents and real photos, or they are not made.
3. **Every path ends at the Admission form.** The landing page exists to turn interest into an Applied lead, with or without a referral.
4. **Nothing is lost.** Staff screens make history visible and make destructive actions impossible rather than merely discouraged.
5. **Speak the family's language.** Swahili and English carry equal weight on the public side.

## Accessibility & Inclusion

Public pages must stay readable and usable on small screens and slow connections, and in both languages. No formal WCAG level has been set yet.
