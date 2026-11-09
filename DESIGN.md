---
name: Al-Rahmah Complex
description: One brand, two volumes. An open invitation to parents on the public site, a calm working tool for staff.
colors:
  rahmah-indigo: "#0900bb"
  indigo-deep: "#070099"
  indigo-night: "#03004d"
  lavender-mist: "#e0dcf9"
  lavender-whisper: "#f2f0fc"
  sunrise-orange: "#ee7300"
  sunrise-ember: "#cc6200"
  sunrise-deep: "#b35500"
  peach-glow: "#ffe1cc"
  paper: "#ffffff"
  slate-canvas: "#f1f5f9"
  slate-ink: "#1e293b"
  slate-quiet: "#94a3b8"
  staff-ink: "oklch(0.205 0 0)"
  staff-line: "oklch(0.922 0 0)"
  alert-red: "#dc2626"
typography:
  display:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 800
    lineHeight: 1.2
  headline:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.33
  label-band:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 800
    letterSpacing: "1px"
  action:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  staff-heading:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.27
    letterSpacing: "-0.025em"
  staff-section:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  staff-ui:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
  staff-name:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
  caption:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  staff-eyebrow:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  staff-count:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  card-hero: "40px"
  card-hero-wide: "50px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
  2xl: "40px"
components:
  button-invite:
    backgroundColor: "{colors.sunrise-orange}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-invite-hover:
    backgroundColor: "{colors.sunrise-ember}"
    textColor: "{colors.paper}"
  name-band:
    backgroundColor: "{colors.rahmah-indigo}"
    textColor: "{colors.paper}"
    typography: "{typography.label-band}"
    rounded: "{rounded.pill}"
    height: "44px"
  input-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 16px 0 40px"
  card-hero:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card-hero}"
    padding: "40px 32px"
    width: "325px"
  button-staff:
    backgroundColor: "{colors.staff-ink}"
    textColor: "{colors.paper}"
    typography: "{typography.staff-ui}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 12px"
  button-staff-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.staff-ink}"
    rounded: "{rounded.lg}"
    height: "40px"
  button-staff-sm:
    rounded: "{rounded.lg}"
    height: "32px"
  input-staff:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.staff-ink}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 12px"
  chip-applied:
    backgroundColor: "#f1f5f9"
    textColor: "#314158"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-visited:
    backgroundColor: "{colors.lavender-whisper}"
    textColor: "{colors.indigo-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-interviewed:
    backgroundColor: "#fff4ec"
    textColor: "#9f2d00"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-enrolled:
    backgroundColor: "#f0fdf4"
    textColor: "#016630"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-declined:
    backgroundColor: "#fef2f2"
    textColor: "#c10007"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-inactive:
    backgroundColor: "{colors.paper}"
    textColor: "#45556c"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  chip-archived:
    backgroundColor: "#e2e8f0"
    textColor: "#314158"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
  card-staff:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: Al-Rahmah Complex

## Overview

**Creative North Star: "The Open Invitation"**

Al-Rahmah's printed flyers greet parents with a school that is open and waiting for their child. The flyers use stacked indigo pills, bold italic type that leans forward, and one orange call to enrol. The design system carries that feeling onto the screen in Al-Rahmah Indigo with a warm orange for every action. Every public surface should read as an invitation: warm, confident and easy to accept from a phone in one hand. The forward slant of Exo italic, the fully rounded pill and the soft indigo glow under a raised card are the three moves that make a screen look like Al-Rahmah.

The system has **two volumes**. The public site (landing page, Admission form, Marketing Agent registration) plays at full flyer strength: indigo fields, orange actions, Exo italic display type. The staff portal plays quietly, because staff use it for hours at a desk with a family watching. There, neutral shadcn surfaces and Geist carry the work, and the brand appears only in details: the logo, the page heading, the primary action and the lead status colours. Sign-in is the doorway between the two, so it keeps the public volume.

**Key Characteristics:**
- Two brand colours only, Rahmah Indigo and Sunrise Orange, supported by lavender and peach tints.
- Exo in heavy italic for anything that speaks to a parent; Geist upright for reading and for staff work.
- Pills everywhere a person acts: buttons, inputs, name bands.
- Depth from large, soft, indigo-tinted shadows under the one surface that matters.
- Loud outside, calm inside.

## Colors

A two-colour brand (indigo authority, orange warmth) on white and pale lavender, with a neutral grey set for the staff side. The scales live in `app/globals.css` as Tailwind's `blue-*` and `orange-*`: Rahmah Indigo is `blue-600`, Sunrise Orange is `orange-500`.

### Primary
- **Rahmah Indigo**: the brand itself. Name bands, display headings, links on public pages, the current navigation item. It is the colour of trust and belongs on anything that says "this is Al-Rahmah". The logo keeps its own printed colours.
- **Indigo Deep**: pressed and hover states on indigo surfaces.
- **Indigo Night**: the darkest indigo, for footers or full-bleed indigo sections where white text needs extra depth.

### Secondary
- **Sunrise Orange**: the invitation. Reserved for the action a parent should take next (Apply, Enrol, Log In) and for small accents that echo the flyer's orange capsules. Text on it is white (The ShuleFasta Button Rule).
- **Sunrise Ember**: hover and pressed state of Sunrise Orange, and the orange used for text links on white.
- **Sunrise Deep** (`orange-700`): orange text on white or on the orange tint, such as a finished progress number, the limited-time pill and the application count. It measures 4.7:1 on the orange tint.

### Tertiary
- **Lavender Mist** and **Lavender Whisper**: the page atmosphere. The public background is a diagonal wash from Lavender Whisper through half-strength Lavender Mist to white. Lavender Whisper is also the background of the current staff navigation item.
- **Peach Glow**: warm tint for highlights, tags and soft fills beside orange.

### Neutral
- **Paper**: cards, inputs and every raised surface.
- **Slate Canvas**: default body background behind non-branded pages.
- **Slate Ink**: body text on public pages.
- **Slate Quiet**: placeholder text and input icons.
- **Staff Ink** and **Staff Line**: shadcn's neutral primary and border, the base palette of the staff portal.
- **Alert Red**: inline error messages.

### Named Rules
**The One Invitation Rule.** Sunrise Orange marks the single next step on a screen. If two things are orange, one of them is wrong.

**The ShuleFasta Button Rule.** Every orange action is `orange-500` (`#ee7300`) with white semibold text, `orange-600` (`#cc6200`) on hover and a `blue-600` focus ring, in the surface's own pill or 10 to 12px radius, through the `orange` variant of `components/ui/button.tsx`. White on `#ee7300` measures about 3.0:1, under WCAG AA's 4.5:1 for normal text. The owner accepted white on orange on 2026-11-06 and chose `#ee7300` on 2026-11-09, replacing ShuleFasta's `#fd6914`; it is a recorded risk, not a defect to fix. Do not add dark text or a darker orange to raise it. Keep labels short, semibold and at least 14px.

**The Quiet Staff Rule.** Staff screens stay neutral. Rahmah Indigo may mark the current navigation item and links; Sunrise Orange may mark one primary action and the waiting counts; the status chips carry the lead lifecycle in soft tints. Everything else, page headings included, is Staff Ink on Paper.

## Typography

**Display Font:** Exo (self-hosted through `next/font/local` from `@fontsource-variable/exo`, weights 300 to 800, normal and italic)
**Body Font:** Geist (with system-ui fallback)

**Character:** Exo italic is the flyer's voice: geometric, fast and a little sporty, and it leans toward the reader. Geist is the steady partner that carries paragraphs, tables and forms without asking for attention.

### Hierarchy
- **Display** (Exo 800 italic, 1.875rem, 1.2): the page's one headline on public pages. The landing page will need a larger mobile-first clamp, to be set when it is built.
- **Headline** (Exo 800 italic, 1.5rem, 1.33): section and card headings in brand colour, for example "Welcome!" on sign-in.
- **Label band** (Exo 800 italic, 1rem, uppercase, 1px tracking): text inside an indigo name band, e.g. "AL-RAHMAH COMPLEX".
- **Action** (Exo 600 italic, 1rem): white labels on orange action buttons.
- **Body** (Geist 400, 1rem, 1.5): all reading text. Keep lines to 65–75ch.
- **Staff heading** (Geist 600, 1.375rem/22px, tight tracking, Staff Ink): the one `<h1>` on every staff page, through the `staff-heading` utility in `app/globals.css`. Staff pages never use the Exo italic heading; sign-in keeps it, because it is the doorway.
- **Staff section** (Geist 600, 0.9375rem/15px, tight tracking, Staff Ink): section and card headings on staff pages, through `staff-section-heading`.
- **Staff UI** (Geist 500, 0.875rem): buttons, labels and table text in the staff portal.
- **Staff name** (Geist 600, 0.8125rem/13px): the signed-in person's name in the account menu.
- **Caption** (Geist 500, 0.75rem/12px): status chips, helper text, and small links and messages on sign-in.
- **Staff eyebrow** (Geist 600, 0.6875rem/11px, uppercase, 0.08em tracking, Slate 500): sidebar group names, tab-bar labels and small section labels such as "Needs you today".
- **Staff count** (Geist 600, 0.625rem/10px): the count on a folded sidebar rail icon, and nowhere else.

### Named Rules
**The Lean Forward Rule.** Exo is always italic, and heavy (700–800) when it is a heading or band; an action label is 600, as The ShuleFasta Button Rule says. Upright Exo does not appear.

**The Readable Field Rule.** Text a person types is at least 16px, upright Geist, so iOS does not zoom and older eyes can read it. The sign-in inputs follow it too, inside their pills with their icons.

## Layout

Public surfaces are **single-column and phone-first**. Content sits in a centred stack with generous vertical gaps (20px between logo, band and heading; 12px between form fields). Hero cards are narrow (325px, capped at 90vw) and centred on the lavender wash, with 16px page padding on phones and 32px from the `sm` breakpoint (640px). Spacing steps come from Tailwind's 4px base; the steps in real use are 8, 12, 16, 20, 32 and 40px.

Staff surfaces use shadcn's density with taller controls: buttons, inputs and selects are 40px tall, and 44px on a touch screen (the `staff-touch` variant: `pointer: coarse` inside the staff shell, so public pages keep their own heights), so a tablet at the admissions desk gets a full touch target. The `sm` size stays 32px for secondary actions inside a card. Cards use 16px padding, 12px in compact cards. Staff screens are designed first for a desktop or laptop at the admissions desk.

## Elevation & Depth

Depth is **soft, coloured and rare**. At most one surface per screen is lifted: the card or panel that holds the task. It gets a large, diffuse shadow tinted with the brand colour instead of grey, so it seems to float on the lavender wash. Primary buttons carry a small orange-tinted shadow and rise 2px on hover. Everything else is flat. Staff screens use shadcn's flat surfaces with a 1px ring and no coloured shadows.

### Shadow Vocabulary
- **Indigo lift** (`box-shadow: 0 30px 80px -15px rgb(9 0 187 / 0.25)`): the one hero card on a public screen.
- **Sun lift** (`box-shadow: 0 4px 6px -1px rgb(238 115 0 / 0.25), 0 2px 4px -2px rgb(238 115 0 / 0.25)`): the primary orange button.
- **Band rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): indigo name bands.

### Named Rules
**The One Lift Rule.** Only one surface per screen gets the Indigo lift. Stacked glowing cards turn an invitation into noise.

## Shapes

The form language is the **capsule**. Anything a person presses or types into is a full pill (9999px). Hero cards use very large corners (40px on phones, 50px from 640px) so they read as soft tiles, like the rounded panels on the flyers. Staff components keep shadcn's gentler scale, built on a 10px base: 6px, 8px, 10px and 14px for cards. Borders are thin: a 1px indigo line at 30% opacity on public inputs, and shadcn's neutral 1px ring on staff cards.

## Components

### Buttons
Round, bold, eager.
- **Shape:** full pill (9999px), 44px tall on public pages.
- **Invite (primary public):** Sunrise Orange with a white semibold italic Exo label, Sun lift shadow, full width inside a hero card. It is the `orange` variant of `components/ui/button.tsx` in the surface's own shape; the same variant is every orange action on a Discount code page, in the Admission form and in the staff portal.
- **Hover / Active:** darkens to Sunrise Ember and rises 2px; scales to 95% while pressed; 70% opacity and no lift while pending, with the label changed to show progress. Focus shows a 3px ring in Rahmah Indigo at 40%.
- **Staff (default / outline):** shadcn Button, 40px tall (44px on a touch screen; `sm` is 32px), 10px corners, Geist 500 at 14px. Default is Staff Ink; outline is Paper with a 1px Staff Line border. Focus shows a 3px ring at 50% ring colour.

### Name band
The flyer's signature capsule on screen. A full-width indigo pill, 44px tall, holding the name in uppercase bold italic Exo with 1px tracking. It sits under the logo on branded doorway screens such as sign-in.

### Cards / Containers
- **Hero card (public):** Paper, 40px corners (50px from 640px), 40px vertical and 32px horizontal padding, Indigo lift. One per screen.
- **Staff card:** shadcn Card, Paper, 14px corners, a 1px ring at 10% foreground, 16px padding (12px in compact cards), no shadow.

### Inputs / Fields
- **Public pill input:** Paper, a 1px indigo border at 30%, full pill, 44px tall, with a 16px Slate Quiet line icon (stroke 1.5) inset on the left. On focus the border turns solid Rahmah Indigo. Each field has a label, visually hidden where the icon and placeholder carry the meaning.
- **Staff input:** shadcn Input or Select, 40px tall (44px on a touch screen), 10px corners, a 1px neutral border and a 3px focus ring. Typed text is 16px on phones and 14px from `md`.
- **Error:** an inline Alert Red message below the fields with `role="alert"`, in plain words that say what to do next.

### Status chips
One component, `StatusChip` in `components/status-chip.tsx`, shows a lead's status or closure mark wherever staff see it: the Leads list, Today, Check-in, Follow-ups and Re-applications. It is 22px tall with 6px corners and a Caption label. Each status has one soft tint with dark text, all at least 4.5:1:

| Chip | Background | Text | Contrast |
|---|---|---|---|
| Applied | `slate-100` | `slate-700` | 9.44:1 |
| Visited | `blue-50` (Lavender Whisper) | `blue-700` (Indigo Deep) | 12.69:1 |
| Interviewed | `orange-50` | `orange-800` | 6.80:1 |
| Enrolled | `green-50` | `green-800` | 6.78:1 |
| Declined | `red-50` | `red-700` | 5.88:1 |
| Inactive (closure) | Paper, 1px `slate-300` ring | `slate-600` | 7.56:1 |
| Archived (closure) | `slate-200` | `slate-700` | 8.40:1 |

Other tags on a lead (Returning family, Initially declined, Seat priority) stay neutral shadcn badges, so the lifecycle colours mean only one thing.

### Navigation
The staff shell (`app/staff/_shell/`) holds the navigation; the Quiet Staff Rule applies to all of it.
- **Sidebar:** a white Paper sidebar, 240px wide, from `md` up, with a 1px Slate 200 line on its right. The logo and "Al-Rahmah Complex / Admissions" sit at the top, the account menu at the bottom.
- **Groups:** the entries sit in five groups, in this order: Front desk, Admissions, Referrals, Money, Admin, each named in the Staff eyebrow style. A group with no entry the person may see is left out. An entry is 32px tall with an 18px lucide icon; the current entry is `blue-600` on `blue-50`, the rest Slate 700 with a Slate 100 hover. Waiting work shows as an orange count pill.
- **Collapsed rail:** the toggle in the top bar folds the sidebar to a 72px rail of icons with tooltips and counts on the icons. A cookie keeps the choice, so a reload paints it folded from the start.
- **Bottom tab bar:** on a phone the sidebar gives way to a fixed white tab bar with Today, Check-in and Leads (each only when the person may see it) and More, which opens a sheet with every other entry and Sign out. The current tab is `blue-600`.
- **Logo:** rendered at its own aspect ratio with both width and height set, 36×28 in the sidebar and 32×24 in the phone top bar.

### Brand top bar
Public form pages (the Admission form and the Discount code pages) open with one row, `BrandTopBar` in `components/brand/`, in a 44px | 1fr | 44px grid. On the left is the round logo in a 44px circle with a 1.5px indigo outline at 22%; it links to alrahmahcomplex.or.tz in the same tab. In the middle is the badge, the name band shrunk to a pill: 44px, Rahmah Indigo, Exo 800 italic, uppercase, 1px tracking, 15px text. It reads "AL-RAHMAH SCHOOLS" on pages for parents and "AL-RAHMAH COMPLEX" on pages for staff and code holders, and its text steps down at 380, 330 and 300px so it never pushes the row wide. On the right is the menu, a 44px outlined circle with a three-bar icon. Its panel holds the Kiswahili | English control, the only language switch on these pages, and, where the page has a form, a red "Futa fomu yote" item that asks once before it clears. The page title moves into an `sr-only` `<h1>`. `/login` keeps its own card.

On a visitor's first visit (no `lang` cookie) a language card grows out of the menu button over a frosted indigo backdrop. It asks in Swahili, waits 5 seconds unless the visitor is reading or using it, confirms the choice for 3 seconds, then shrinks back into the menu button, which pops with an orange ring.

### Guided form (concept C)
The Admission form and the Discount code registration ask one question at a time. The pieces live in `components/guided-form/`, with usage in its README.
- **Progress bar:** a sticky row above the questions. Back sits on the left, and Start over takes its place on the first question; both are 44px outlined circles. Three groups of 6px chips follow, one chip per step, each group led by a small indigo number. When a group finishes, its chips close into one bar, a light runs through it, a green tick lands on its end and the number pops and turns Sunrise Deep. An outlined chip on the right names the section; it hides under 380px.
- **Folding cards:** the open question is centred, with the title in Exo 800 italic at 26px. Answering folds the card into a one-line summary with a tick dot, the label and value on the left and a two-word "Badilisha …" link on the right. The folded lines become the review, so there is no separate check page. Group titles ("Mwanafunzi", "Msimamizi", "Usaili") sit between the groups.
- **Choices:** real radios drawn as pills with the tick on the right, a segmented grid for short answers, and one big default tile for the common answer with a small tagline above it.
- **Continue:** a full-width Sunrise Orange pill in Exo italic that always ends with ›. The outlined pill is for the other way forward, such as adding another student.
- **Offer and price:** the price box sets the full fee on a faint orange half against the saving on a faint green half. The limited-time note has a clock icon on the orange tint, and an outlined Sunrise Deep pill and ⓘ buttons open a bottom sheet over a frosted indigo backdrop. Every urgency line must be true. No countdowns.
- **Motion:** folds take 300ms on an exponential ease-out, the sheet slides up in 320ms, and confetti in orange and indigo follows a sent form. Under reduced motion the folds are instant with a 120ms fade, the sheet fades and the confetti, cheers and balloon are skipped.

### App icon
The site installs as an app from `app/manifest.ts`. Every icon is the full Al-Rahmah logo, never the globe-and-book emblem alone: `public/icons/` holds the any, maskable and monochrome sizes, `public/apple-touch-icon.png` the iPhone icon and `app/favicon.ico` the tab icon. The theme colour is Rahmah Indigo.

## Do's and Don'ts

### Do:
- **Do** put the Al-Rahmah logo at the top of every branded doorway screen, above an indigo name band.
- **Do** use the lavender diagonal wash (Lavender Whisper → half-strength Lavender Mist → white) as the background of public screens.
- **Do** keep Exo italic wherever it appears: 700–800 for headings and bands, 600 for orange action labels.
- **Do** give every control a 44px touch height on public pages.
- **Do** make every orange action the shared `orange` button variant: white semibold text on Sunrise Orange (The ShuleFasta Button Rule).

### Don't:
- **Don't** use Sunrise Orange for more than one action on a screen.
- **Don't** put dark text, or a darker orange, on an orange action to raise its contrast; the 3.0:1 ratio is the owner's accepted choice. Keep the label short, semibold and at least 14px instead.
- **Don't** bring flyer volume into the staff portal: no indigo sidebars, coloured stat tiles or glowing cards there.
- **Don't** set typed input text below 16px.
- **Don't** lift more than one surface per screen, and don't use grey drop shadows on public surfaces; lift is tinted.
- **Don't** add colours outside the palette. The lead lifecycle colours are the status chips above; don't style a status ad hoc with a badge variant.
