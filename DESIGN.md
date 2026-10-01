---
name: Al-Rahmah Complex
description: One brand, two volumes. An open invitation to parents on the public site, a calm working tool for staff.
colors:
  rahmah-indigo: "#0900bb"
  indigo-deep: "#070099"
  indigo-night: "#03004d"
  lavender-mist: "#e0dcf9"
  lavender-whisper: "#f2f0fc"
  sunrise-orange: "#f58220"
  sunrise-ember: "#da6b0d"
  peach-glow: "#ffdec4"
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
    fontWeight: 700
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  staff-ui:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
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
    textColor: "{colors.rahmah-indigo}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-invite-hover:
    backgroundColor: "{colors.sunrise-ember}"
    textColor: "{colors.indigo-night}"
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
    height: "32px"
    padding: "0 10px"
  button-staff-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.staff-ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  card-staff:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: Al-Rahmah Complex

## Overview

**Creative North Star: "The Open Invitation"**

Al-Rahmah's printed flyers greet parents with a school that is open and waiting for their child. The flyers use stacked indigo pills, bold italic type that leans forward, and one orange call to enrol. The design system carries that feeling onto the screen. Every public surface should read as an invitation: warm, confident and easy to accept from a phone in one hand. The forward slant of Exo italic, the fully rounded pill and the soft indigo glow under a raised card are the three moves that make a screen look like Al-Rahmah.

The system has **two volumes**. The public site (landing page, Admission form, Marketing Agent registration) plays at full flyer strength: indigo fields, orange actions, Exo italic display type. The staff portal plays quietly, because staff use it for hours at a desk with a family watching. There, neutral shadcn surfaces and Geist carry the work, and the brand appears only in details: the logo, the page heading, the primary action and the lead status colours. Sign-in is the doorway between the two, so it keeps the public volume.

**Key Characteristics:**
- Two brand colours only, Rahmah Indigo and Sunrise Orange, supported by lavender and peach tints.
- Exo in heavy italic for anything that speaks to a parent; Geist upright for reading and for staff work.
- Pills everywhere a person acts: buttons, inputs, name bands.
- Depth from large, soft, indigo-tinted shadows under the one surface that matters.
- Loud outside, calm inside.

## Colors

A two-colour brand (indigo authority, orange warmth) on white and pale lavender, with a neutral grey set for the staff side.

### Primary
- **Rahmah Indigo**: the brand itself. Name bands, display headings, links on public pages, the logo's field. It is the colour of trust and belongs on anything that says "this is Al-Rahmah".
- **Indigo Deep**: pressed and hover states on indigo surfaces.
- **Indigo Night**: the darkest indigo, for footers or full-bleed indigo sections where white text needs extra depth.

### Secondary
- **Sunrise Orange**: the invitation. Reserved for the action a parent should take next (Apply, Enrol, Log In) and for small accents that echo the flyer's orange capsules.
- **Sunrise Ember**: hover and pressed state of Sunrise Orange, and the orange used for text links on white.

### Tertiary
- **Lavender Mist** and **Lavender Whisper**: the page atmosphere. The public background is a diagonal wash from Lavender Mist through half-strength Lavender Mist to white.
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

**The Legible Sun Rule.** White text on Sunrise Orange measures about 2.6:1 and fails WCAG AA at every size. Put Rahmah Indigo text on Sunrise Orange (about 4.7:1), or use Sunrise Ember with white text at 18.66px bold or larger. The current sign-in button breaks this rule and is a known defect.

**The Quiet Staff Rule.** Staff screens stay neutral. Rahmah Indigo may mark the page heading and the current navigation item; Sunrise Orange may mark one primary action. Everything else is Staff Ink on Paper.

## Typography

**Display Font:** Exo (self-hosted through `next/font/local` from `@fontsource-variable/exo`, weights 300 to 800, normal and italic)
**Body Font:** Geist (with system-ui fallback)

**Character:** Exo italic is the flyer's voice: geometric, fast and a little sporty, and it leans toward the reader. Geist is the steady partner that carries paragraphs, tables and forms without asking for attention.

### Hierarchy
- **Display** (Exo 800 italic, 1.875rem, 1.2): the page's one headline on public pages. The landing page will need a larger mobile-first clamp, to be set when it is built.
- **Headline** (Exo 800 italic, 1.5rem, 1.33): section and card headings in brand colour, for example "Welcome!" on sign-in.
- **Label band** (Exo 800 italic, 1rem, uppercase, 1px tracking): text inside an indigo name band, e.g. "AL-RAHMAH COMPLEX".
- **Action** (Exo 700 italic, 1rem): labels on public call-to-action buttons.
- **Body** (Geist 400, 1rem, 1.5): all reading text. Keep lines to 65–75ch.
- **Staff UI** (Geist 500, 0.875rem): buttons, labels and table text in the staff portal.

### Named Rules
**The Lean Forward Rule.** Exo is always italic and always heavy (700–800) when it is a heading, band or action. Upright Exo does not appear.

**The Readable Field Rule.** Text a person types is at least 16px. The sign-in inputs currently use 12px light italic, which triggers zoom on iOS and strains older eyes; new forms must not copy it.

## Layout

Public surfaces are **single-column and phone-first**. Content sits in a centred stack with generous vertical gaps (20px between logo, band and heading; 12px between form fields). Hero cards are narrow (325px, capped at 90vw) and centred on the lavender wash, with 16px page padding on phones and 32px from the `sm` breakpoint (640px). Spacing steps come from Tailwind's 4px base; the steps in real use are 8, 12, 16, 20, 32 and 40px.

Staff surfaces use shadcn's density: 32px controls, 16px card padding, 12px card padding in compact cards. They are designed first for a desktop or laptop at the admissions desk.

## Elevation & Depth

Depth is **soft, coloured and rare**. At most one surface per screen is lifted: the card or panel that holds the task. It gets a large, diffuse shadow tinted with the brand colour instead of grey, so it seems to float on the lavender wash. Primary buttons carry a small orange-tinted shadow and rise 2px on hover. Everything else is flat. Staff screens use shadcn's flat surfaces with a 1px ring and no coloured shadows.

### Shadow Vocabulary
- **Indigo lift** (`box-shadow: 0 30px 80px -15px rgb(9 0 187 / 0.25)`): the one hero card on a public screen.
- **Sun lift** (`box-shadow: 0 4px 6px -1px rgb(245 130 32 / 0.2), 0 2px 4px -2px rgb(245 130 32 / 0.2)`): the primary orange button.
- **Band rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): indigo name bands.

### Named Rules
**The One Lift Rule.** Only one surface per screen gets the Indigo lift. Stacked glowing cards turn an invitation into noise.

## Shapes

The form language is the **capsule**. Anything a person presses or types into is a full pill (9999px). Hero cards use very large corners (40px on phones, 50px from 640px) so they read as soft tiles, like the rounded panels on the flyers. Staff components keep shadcn's gentler scale, built on a 10px base: 6px, 8px, 10px and 14px for cards. Borders are thin: a 1px indigo line at 30% opacity on public inputs, and shadcn's neutral 1px ring on staff cards.

## Components

### Buttons
Round, bold, eager.
- **Shape:** full pill (9999px), 44px tall on public pages.
- **Invite (primary public):** Sunrise Orange with a bold italic Exo label, Sun lift shadow, full width inside a hero card.
- **Hover / Active:** darkens to Sunrise Ember and rises 2px; scales to 95% while pressed; 70% opacity and no lift while pending, with the label changed to show progress.
- **Staff (default / outline):** shadcn Button, 32px tall, 10px corners, Geist 500 at 14px. Default is Staff Ink; outline is Paper with a 1px Staff Line border. Focus shows a 3px ring at 50% ring colour.

### Name band
The flyer's signature capsule on screen. A full-width indigo pill, 44px tall, holding the name in uppercase bold italic Exo with 1px tracking. It sits under the logo on branded doorway screens such as sign-in.

### Cards / Containers
- **Hero card (public):** Paper, 40px corners (50px from 640px), 40px vertical and 32px horizontal padding, Indigo lift. One per screen.
- **Staff card:** shadcn Card, Paper, 14px corners, a 1px ring at 10% foreground, 16px padding (12px in compact cards), no shadow.

### Inputs / Fields
- **Public pill input:** Paper, a 1px indigo border at 30%, full pill, 44px tall, with a 16px Slate Quiet line icon (stroke 1.5) inset on the left. On focus the border turns solid Rahmah Indigo. Each field has a label, visually hidden where the icon and placeholder carry the meaning.
- **Staff input:** shadcn Input, 32px tall, 8px corners, a 1px neutral border and a 3px focus ring.
- **Error:** an inline Alert Red message below the fields with `role="alert"`, in plain words that say what to do next.

### Navigation
There is no navigation component yet. The public landing page and the staff portal shell will define it; the Quiet Staff Rule and the One Invitation Rule both apply.

## Do's and Don'ts

### Do:
- **Do** put the Al-Rahmah logo at the top of every branded doorway screen, above an indigo name band.
- **Do** use the lavender diagonal wash (Lavender Mist → half-strength Lavender Mist → white) as the background of public screens.
- **Do** keep Exo italic and heavy (700–800) wherever it appears.
- **Do** give every control a 44px touch height on public pages.
- **Do** put Rahmah Indigo text on Sunrise Orange, or Sunrise Ember with large bold white text (The Legible Sun Rule).

### Don't:
- **Don't** use Sunrise Orange for more than one action on a screen.
- **Don't** put small white text on Sunrise Orange; it fails contrast.
- **Don't** bring flyer volume into the staff portal: no indigo sidebars, coloured stat tiles or glowing cards there.
- **Don't** set typed input text below 16px.
- **Don't** lift more than one surface per screen, and don't use grey drop shadows on public surfaces; lift is tinted.
- **Don't** add colours outside the palette. Status colours for the lead lifecycle will be defined with the staff portal, from the palette's tints first.
