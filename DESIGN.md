---
name: Al-Rahmah Complex
description: One design language for parents and staff. An open invitation, from the Admission form to the admissions desk.
colors:
  rahmah-indigo: "#0900bb"
  indigo-deep: "#070099"
  indigo-night: "#03004d"
  lavender-mist: "#e0dcf9"
  lavender-whisper: "#f2f0fc"
  lavender-chrome: "#f8f7fd"
  indigo-line: "rgb(9 0 187 / 0.22)"
  indigo-line-strong: "rgb(9 0 187 / 0.45)"
  indigo-line-soft: "rgb(9 0 187 / 0.12)"
  sunrise-orange: "#ee7300"
  sunrise-ember: "#cc6200"
  sunrise-deep: "#b35500"
  orange-tint: "#fff4e8"
  peach-glow: "#ffcfa6"
  paper: "#ffffff"
  slate-ink: "#1e293b"
  slate-soft: "#475569"
  slate-quiet: "#64748b"
  slate-quiet-on-tint: "#566478"
  placeholder: "#8a94a6"
  go-green: "#0f7a3d"
  green-tint: "#eefbf3"
  alert-red: "#c81e1e"
  red-tint: "#fef2f2"
typography:
  page-title:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    fontStyle: italic
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  question:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    fontStyle: italic
    lineHeight: 1.18
  card-title:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    fontStyle: italic
    lineHeight: 1.3
  section-title:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    fontStyle: italic
    lineHeight: 1.3
  label-band:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    fontStyle: italic
    letterSpacing: "1px"
  action:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    fontStyle: italic
  nav-current:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 700
    fontStyle: italic
  nav-group:
    fontFamily: "Exo, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    fontStyle: italic
    letterSpacing: "0.06em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-public:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  field:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  row-title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
  nav:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  caption:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  chip:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  table-head:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  nav-row: "14px"
  note: "16px"
  choice: "20px"
  menu: "22px"
  card: "24px"
  stage: "28px"
  sheet: "28px"
  hero: "40px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-go:
    backgroundColor: "{colors.sunrise-orange}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 22px"
  button-go-hover:
    backgroundColor: "{colors.sunrise-ember}"
    textColor: "{colors.paper}"
  button-go-wide:
    backgroundColor: "{colors.sunrise-orange}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "52px"
    width: "100%"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.rahmah-indigo}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 22px"
  button-small:
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 16px"
  button-round:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.rahmah-indigo}"
    rounded: "{rounded.pill}"
    size: "44px"
  button-round-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.rahmah-indigo}"
    rounded: "{rounded.pill}"
    size: "40px"
  input-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.field}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 20px"
  input-pill-compact:
    backgroundColor: "{colors.lavender-chrome}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 20px 0 40px"
  choice-row:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.choice}"
    height: "60px"
    padding: "10px 56px"
  choice-row-selected:
    backgroundColor: "{colors.rahmah-indigo}"
    textColor: "{colors.paper}"
  filter-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.rahmah-indigo}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 14px"
  filter-pill-pressed:
    backgroundColor: "{colors.rahmah-indigo}"
    textColor: "{colors.paper}"
  chip-status:
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    height: "24px"
    padding: "0 10px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "22px 24px"
  card-task:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.hero}"
    padding: "30px 28px"
  nav-row:
    textColor: "{colors.slate-soft}"
    typography: "{typography.nav}"
    rounded: "{rounded.nav-row}"
    height: "26px"
    padding: "0 10px"
  nav-row-current:
    backgroundColor: "{colors.lavender-whisper}"
    textColor: "{colors.rahmah-indigo}"
    typography: "{typography.nav-current}"
  note-info:
    backgroundColor: "{colors.lavender-whisper}"
    textColor: "{colors.indigo-night}"
    rounded: "{rounded.note}"
    padding: "12px 14px"
  toast:
    backgroundColor: "{colors.indigo-night}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  name-band:
    backgroundColor: "{colors.rahmah-indigo}"
    textColor: "{colors.paper}"
    typography: "{typography.label-band}"
    rounded: "{rounded.pill}"
    height: "44px"
---

# Design System: Al-Rahmah Complex

## Overview

**Creative North Star: "The Open Invitation"**

Al-Rahmah's printed flyers greet parents with a school that is open and waiting for their child: stacked indigo pills, bold italic type that leans forward, one orange call to enrol. The screen carries that feeling in Al-Rahmah Indigo with a warm orange for every next step. A parent filling in the Admission form and a member of staff registering a student at the admissions desk see the same family of screens: the same pills, the same lavender wash, the same Exo italic, the same progress bar. The owner wants staff to enjoy registering a student as much as a parent enjoys applying.

There is **one design language and one volume**. The Admission form (`components/guided-form/`) is its reference implementation. The staff app adopts it whole. The earlier split, a loud public side and a quiet neutral staff side ("The Quiet Staff Rule"), was retired by the owner on 2026-11-11.

The approved staff prototype is the visual reference for every staff screen it shows: <https://claude.ai/artifact/5Hs5yCjHeifmHpvHg2yeYr> (Design A, icon set 1). Where this file and the prototype disagree on a value, the prototype wins and this file is corrected.

**Key Characteristics:**
- Two brand colours, Rahmah Indigo and Sunrise Orange, on white and a pale lavender wash.
- Exo is always italic: page titles, questions, card titles, buttons, the current sidebar item. Everything people read in quantity or type is Geist, upright.
- Pills wherever a person presses or types. Large soft corners on cards.
- White cards with a thin indigo outline and a soft indigo shadow. Only the card that holds the task is lifted.
- A clean desk: whitespace, one idea per block, subtle motion, no count badges (The One Pip Rule).

## Colors

The tokens live in `app/tokens.css` as `--gf-*` custom properties, which the root layout loads on every page. `app/globals.css` maps them to Tailwind utilities (`bg-gf-whisper`, `text-gf-indigo`, `shadow-gf-card`, `bg-gf-wash`) and also keeps Tailwind's `blue-*` and `orange-*` scales (Rahmah Indigo is `blue-600`, Sunrise Orange is `orange-500`). Use a token, never a new hex value: `scripts/design-lint.mjs` fails CI on a hex value in `components/kit/`, `components/icons/` or a staff route, and on upright Exo anywhere.

### Primary
- **Rahmah Indigo** (`--gf-indigo`, `#0900bb`): titles, links, the current sidebar item, selected choices, outlines of round buttons, line icons when active.
- **Indigo Deep** (`#070099`): the Visited chip's text and pressed states on indigo.
- **Indigo Night** (`--gf-indigo-night`, `#03004d`): toasts, the illustration outline, and the backdrop of sheets and the phone drawer at 40%.

### Secondary
- **Sunrise Orange** (`--gf-orange`, `#ee7300`): the one next step on a screen, the bell's unread pip, and the text caret in fields. White text on it (The ShuleFasta Button Rule).
- **Sunrise Ember** (`--gf-ember`, `#cc6200`): hover and pressed state of an orange button.
- **Sunrise Deep** (`--gf-orange-deep`, `#b35500`): orange text on white or on the orange tint, such as a finished group's number in the progress bar or a waiting chip.
- **Orange Tint** (`--gf-orange-tint`, `#fff4e8`) and **Peach Glow** (`#ffcfa6`): warm fills. Peach Glow is the soft shape inside an active icon.

### Tertiary
- **Lavender Mist** (`--gf-mist`, `#e0dcf9`): dividers between rows and sections, empty progress chips, the lavender wash.
- **Lavender Whisper** (`--gf-whisper`, `#f2f0fc`): the current sidebar item, hover on outlined buttons, icon discs, info notes.
- **Lavender Chrome** (`--gf-chrome`, `#f8f7fd`): hover on rows and choices, the top-bar search field at rest.
- **Indigo Line** (`--gf-line`, indigo at 22%): the thin outline (`--gf-stroke`) of cards, inputs, round buttons and chips. **Line Strong** (45%) on hover and on ghost buttons. **Line Soft** (12%) for the faintest rings.

### Neutral
- **Paper** (`#ffffff`): cards, inputs, sheets, the sidebar and the frame around the stage.
- **Slate Ink** (`--gf-ink`, `#1e293b`): body text. **Slate Soft** (`#475569`): subtitles and resting sidebar items. **Slate Quiet** (`#64748b`): captions and table headings (never icons: they are indigo), on white only, where it reads 4.76:1. **Quiet on tint** (`--gf-quiet-on-tint`, `#566478`): the same text on Lavender Whisper, Chrome or Mist, or a note's tint, where Slate Quiet falls under 4.5:1; it reads 4.52:1 on Mist. **Placeholder** (`#8a94a6`).
- **Go Green** (`#0f7a3d`) on **Green Tint** (`#eefbf3`): success marks and the finished-group tick. **Alert Red** (`#c81e1e`) on **Red Tint** (`#fef2f2`): field errors and destructive confirmation.

### The page wash
Every page body sits on a lavender wash. The staff look reads `--gf-wash`: `linear-gradient(135deg, #f6f5fd 0%, rgb(224 220 249 / 0.35) 45%, #fff 100%)`, 30% fainter since prototype v38. On staff screens it fills the stage (see Layout), not the white frame around it. The public pages still draw the old wash (`#f2f0fc` through half Mist) with their own classes until they move to v38.

### Named Rules
**The One Invitation Rule.** Sunrise Orange marks the single next step on a screen. If two buttons are orange, one of them is wrong. A sheet counts as its own screen while it is open.

**The ShuleFasta Button Rule.** Every orange action is `#ee7300` with white Exo 600 italic text, `#cc6200` on hover, the Sun lift shadow and an indigo focus ring, in a full pill, through `ContinuePill` (`variant="go"`) or the `orange` variant of `components/ui/button.tsx`. White on `#ee7300` measures about 3.0:1, under WCAG AA's 4.5:1 for normal text. The owner accepted it on 2026-11-06 and chose `#ee7300` on 2026-11-09; it is a recorded risk, not a defect to fix. Do not add dark text or a darker orange to raise it. Keep labels short and at least 14px.

**The One Pip Rule.** The only unread marker in the staff app is the orange pip on the notification bell. The sidebar, page titles, rows and tabs never show a count badge. A count a person needs is written in words: "3 interviews today", "4 follow-ups due".

## Typography

**Display font:** Exo (self-hosted through `next/font/local` from `@fontsource-variable/exo`), italic only.
**Body font:** Geist, with a system-ui fallback.

Exo italic is the flyer's voice: geometric, fast, leaning toward the reader. Geist carries names, numbers, tables and anything typed.

### Hierarchy
| Role | Font | Size and weight | Used for |
|---|---|---|---|
| Page title | Exo italic | 800, 28px/1.15, −0.01em, Rahmah Indigo, `text-wrap: balance` | The one `<h1>` on a staff page. 34px on a narrow centred page such as Today; 24px under 860px (26px on narrow pages). |
| Question | Exo italic | 800, 26px/1.18 | An open question in a guided form, a lifted task card's title, a sheet's title, a finished screen's title. |
| Card title | Exo italic | 800, 17px/1.3, Rahmah Indigo | A card's heading, the bell popover's heading. |
| Section title | Exo italic | 800, 15px/1.3, Rahmah Indigo | A section inside a card or sheet ("Student", "Custodian"). |
| Action | Exo italic | 600, 16px (14px small, 18px wide) | Button labels (Go, Ghost, Small, Wide). Filter pills rest in Geist 600 and turn Exo italic only when pressed; chip buttons stay Geist 600 when pressed. |
| Current sidebar item | Exo italic | 700, 13.5px | The one current entry in the sidebar, and a pressed filter pill. |
| Sidebar group | Exo italic | 700, 10.5px, uppercase, 0.06em, indigo at 62% | "FRONT DESK", "ADMISSIONS"… |
| Brand title | Exo italic | 800, 11–14px, Rahmah Indigo | "Al-Rahmah Complex" in the sidebar; its size follows the sidebar's width. |
| Label band | Exo italic | 800, 15px, uppercase, 1px | The badge in the brand top bar. |
| Subtitle | Geist | 400, 14.5px, Slate Soft, max 62ch | The line under a page title. |
| Body | Geist | 400, 14px/1.5 staff, 16px public | Reading text. Lines stay under 75ch. |
| Row title | Geist | 600, 14.5px | A name in a list row; 16px in a summary row. |
| Sidebar item | Geist | 500, 13px, Slate Soft | Resting sidebar entries. |
| Table | Geist | 400, 14px; headings 600, 12px, Slate Quiet | Tables. |
| Caption | Geist | 400, 12.5px, Slate Quiet | The second line of a row, a reason under a value. |
| Chip | Geist | 600, 12px | Status and tag chips. |
| Field | Geist | 400, 17px (15px compact) | What people type. |

Numbers that line up (money, Admission Numbers, times, counts in tables) use `font-variant-numeric: tabular-nums`. An Admission Number shown as the result of a finished task is Exo 800 italic 20px, Rahmah Indigo.

### Named Rules
**The Lean Forward Rule.** Exo is always italic. Upright Exo never appears, on any page. Check it on the rendered page: no element whose computed `font-family` starts with Exo has `font-style: normal`. A few small lines on the sign-in, password and Discount code pages still set Exo upright; `scripts/design-lint.mjs` lists them by file and allows no more, until a prototype the owner approves turns them italic.

**The Geist Work Rule.** Typed text, table cells, names, numbers and paragraphs are Geist, upright. Exo never sets a table cell, a field's value or a paragraph.

**The Readable Field Rule.** Text a person types is at least 16px on a phone, so iOS does not zoom. The full field is 17px. The compact 44px field and the 40px top-bar search are 15px from 861px up and 16px below.

## Layout

### Public pages
Single column and phone first. Content sits in a centred stack; hero cards are narrow (325px, capped at 90vw) on the lavender wash, with 16px page padding on phones and 32px from 640px. The Admission form opens with the brand top bar and runs inside one task card.

### The staff shell (desktop, from 861px)
A white frame holds a sidebar on the left and one rounded **stage** on the right. The stage holds the page.
- **Frame:** the body is Paper, with 16px side padding (or the safe-area inset if larger), 4px above and 12px below the shell.
- **Top bar:** 54px tall, in the white frame above the stage, not inside it. From left: the sidebar toggle (aligned with the stage's left edge, so it moves with the stage when the sidebar folds or resizes), the search field (`flex: 0 1 340px`), a spacer, the notification bell, and the signed-in person's pill.
- **Stage:** fills the rest. 28px corners, the lavender wash, `overflow: hidden`. Its thin outline (`rgb(9 0 187 / 0.18)`, inset) is drawn on a layer above the content, so the border stays visible while content scrolls beneath it.
- **Page:** inside the stage, a scroll area with 26px top, 40px side and 56px bottom padding, and a page column capped at 1180px, centred. Narrow pages such as Today use a 660px centred column; a guided form uses a 640px centred column.
- **Outside scrollbar:** the stage's native scrollbar is hidden. A 6px bar is drawn in the white gutter right of the stage (11px outside its edge, from 72px below the top to 18px above the bottom): a `#cbc5f6` thumb at least 36px tall, Line Strong on hover and while dragged. Pressing the track jumps there; dragging the thumb scrolls. It shows only when the page can scroll, and it is not drawn on a touch screen (`pointer: coarse`), where the stage scrolls natively.
- **Grids:** cards and columns are 24px apart. A two-column page is `minmax(0, 1.25fr) minmax(280px, 0.9fr)`; a list beside a detail is `320px minmax(0, 1fr)`. Both fall to one column at 1000px.
- **Bento grid:** cards set side by side as equals use the kit's `Bento` (prototype v40, Design system), 14px apart. Every card in a row is as tall as the tallest, with its content at the top, and a short last row fills the width: with three columns a lone last card spans all three and of two last cards the second spans two; with two columns a lone last card spans both. The columns follow the grid's own width: one, two from 580px, three from 880px. The two layouts above keep their columns and their 24px. Reports draws the same rule in its own grid, because its table stands beside the count cards: on wide screens the three rows of counts share the table's height, so the table ends level with the last count; from 640px to 1023px the table goes full width under the counts.

### The sidebar
- **Head:** 54px. The round logo (36px circle, thin Indigo Line outline) at 6px from the left; beside it "Al-Rahmah Complex" (Brand title) over "Admissions Portal" (Geist, 0.8× the title's size, Slate Quiet), the pair centred on the logo's centre line at every title size.
- **Groups:** Front desk, Admissions, Referrals, Money, Admin, in that order, each named in the Sidebar group style. A group with nothing the person may see is left out (`app/staff/navigation.ts`).
- **Rows:** 38px tall and 4px apart (owner, design site round, 27 Nov 2026: more room), 12px side padding, 12px gap, 16px corners, a 16px icon. Group names have 6px more room above them. Hover: Lavender Chrome, indigo text, the icon's detail turns orange, and the label rolls up to a second copy of itself (340ms). Current: Lavender Whisper, indigo, Exo 700 italic 13.5px, the icon's detail orange, `aria-current="page"`.
- **Always fits:** the sidebar never shows a scrollbar. On a short screen rows shrink from 38px and group gaps from 31px toward 15px. Rows stop shrinking at 24px (WCAG 2.2's minimum target); if the entries still do not fit, the list scrolls with its bar hidden, so no entry is ever cut off. A sidebar holding a page's sections keeps its rows full height and scrolls instead. On a touch screen (`pointer: coarse`) every row is 44px tall.
- **A page's sections** (`SidebarSections`, design site round): a page with many sections lists them under its row, inside a 1px Lavender Mist line 20px in, while the sidebar is open. A 30px chevron at the row's right end folds the list. The sections sit in groups whose names are buttons in the Sidebar group style; one group is open at a time. A section row is 32px, 12.5px Geist 500, 12px corners, Lavender Chrome on hover; pressing it scrolls the stage to the block with that id. As the stage scrolls, the section on screen is current (Lavender Whisper, indigo, 600, `aria-current="location"`) and its group opens. A section new to the kit carries a small "New" tag in Orange Tint and Sunrise Deep. Folded, the list hides; in the phone drawer the rows are 40px.
- **Folded:** 60px wide. Labels and the title fade out; the logo stays. Group names become 1px Lavender Mist lines. Each row becomes a circle up to 38px (at least 24px) around its icon, 4px apart; the current one is a 38px Lavender Whisper circle. Each folded icon has a tooltip with its label. Folding takes 460ms on the ease-out curve.
- **Toggle:** a 40px round button in the top bar with no outline at rest, its icon indigo. While the sidebar is open it is pressed: a Lavender Whisper circle, its icon's detail orange (`aria-pressed="true"`).
- **Resize:** a 14px handle straddles the stage's left edge (from 62px below the top to 8px above the bottom) and shows a 2px indigo line at 45% on hover and drag, and at 47%, the colour of `--gf-focus-ring`, on keyboard focus: 3.16:1 on the Paper frame and at least 3.08:1 on the stage's wash, over the 3:1 a focus indicator needs. Dragging sets the open width between two limits. The narrowest is the largest of three widths: 212px, the one that leaves the same gap after the longest label as before the icons (page padding plus row padding), and the one that fits the brand title at its smallest size (11px) plus an 8px gap. The widest is 252px plus half the distance, measured with the sidebar at 252px, from the stage's edge to the page column. Between the two, the brand title scales from 11px to 14px with the width. Double-click returns to the narrowest. Arrow keys move it 8px. It is a `role="separator"` with its value and limits. The handle is gone while the sidebar is folded and under 861px.
- **Remembered:** the folded state and the open width are kept in cookies, so a reload paints the sidebar as it was, with no jump.

### The staff shell on a phone or small tablet (up to 860px)
One column. The top bar sits above the stage; the toggle gives way to a 40px Menu button, and the person's pill shows only the initials. The sidebar becomes a drawer: 272px wide, Paper, 28px corners on its right side, the Indigo lift, sliding in from the left over a frosted Indigo Night backdrop (40%, 6px blur) in 420ms. Choosing an entry or tapping the backdrop closes it. The stage's padding drops to 16px top, 14px sides, 36px bottom; cards to 18px.

### The design site (design.alrahmahcomplex.or.tz)
The design system's own site (prototype v6, owner, 27 Nov 2026): the shell is every site's signature, so it sits in the same frame. The sidebar holds two pages, Design system and Connect an AI, under the group Pages, and the Design system page's sections under its row. The top bar holds the toggle, a search that shows only the parts it matches, and in the person's place a pill reading "Open · For 30 days": a 30px indigo circle with the lock (white, its detail light orange), which opens a popover to lock the browser. No bell. Before the password, the bare shell: the brand in the top bar, nothing else, and the lock screen's task card in the middle of the stage (the step icon with the lock, the title, the password field, a wide Go button "Open"). English only. Every page is static; the routing layer shows the lock screen until the browser gives the password (`lib/site-hosts.ts`).

## Elevation & Depth

Shadows are tinted indigo or orange, never grey, and only the four below exist.

### Shadow Vocabulary
- **Card** (`0 1px 2px rgb(9 0 187 / 0.04), 0 12px 28px -18px rgb(9 0 187 / 0.22)`): every resting white card on the stage.
- **Indigo lift** (`--gf-lift`: `0 30px 80px -15px rgb(9 0 187 / 0.25)`): the one task card, menus, popovers and the phone drawer.
- **Sheet** (`0 -20px 60px -10px rgb(9 0 187 / 0.3)`): a sheet rising from the bottom.
- **Sun lift** (`--gf-sun`: `0 4px 6px -1px rgb(238 115 0 / 0.25), 0 2px 4px -2px rgb(238 115 0 / 0.25)`): orange buttons.

### Named Rules
**The One Lift Rule.** On a page, only the card that holds the task (a guided form, the check-in question, a finished screen) carries the Indigo lift, and it drops its outline. Every other card keeps the outline and the Card shadow. Floating layers (menus, popovers, the drawer) also lift, because they sit above the page.

## Shapes

The form language is the capsule. Buttons, fields, filter pills, chip buttons, status chips and the person's pill are full pills; round buttons are circles. Choice tiles are the exception: segmented choices have 16px corners, choice rows 20px, the default tile 24px. Corners grow with the surface: 12px sidebar section rows, 16px sidebar rows and notes, 18px toasts, 20px choice rows and summary boxes, 22px menus, 24px cards, 28px stage and sheets, 40px task cards. Outlines in the staff look are 0.75px Indigo Line (`--gf-stroke`, half the old 1.5px since prototype v38); the Admission form's own parts keep 1.5px until it moves to v38. Dividers inside a card are 1px Lavender Mist. Nothing has a square corner.

## Components

All of these are built once and shared. Parent pages and staff pages import the same components; a staff screen never restyles a shadcn default in place.

**The Kit First Rule.** Every screen, staff and public, is built only from the design kit: `components/kit`, the guided form's parts (`components/guided-form`), the icons (`components/icons`), the illustrations (`components/illustrations`) and the brand parts (`components/brand`). A part the kit does not have yet, such as a field variant, a button, a card, a banner, an empty state, an icon or an illustration, is added to the kit first, in this order:

1. The prototype draws it on its Design system page, in every state, and then on the screens that use it. The owner approves both (AGENTS.md, UI and UX changes).
2. The build adds it to the kit and shows it on the Design system page (design.alrahmahcomplex.or.tz, `/design` locally; it was `/staff/kit`) in every state, with its entry in `lib/design-site/catalog.ts`, in this file and in the kit's README. The catalogue feeds the page, its sidebar sections, llms.txt and the MCP server, and a test fails when a kit file belongs to no part.
3. Only then does a screen use it.

A screen never draws its own version of a part, keeps a one-off copy, or changes a kit part's look (colour, size, corners, lines, motion) in its own CSS. The screen owns only the layout around the parts: grids, gaps and order. The owner set this rule on 21 November 2026. Parts built before it that sit outside the kit are listed in #508; each moves into the kit through a prototype the owner approves, not as a side effect of other work.

### Buttons
- **Go:** Sunrise Orange pill, 44px, 22px side padding, white Exo 600 italic 16px, Sun lift. Hover: Sunrise Ember and 2px rise. Press: scale 0.96. Pending: 70% opacity, no rise, the label says what is happening ("Saving…"). A Continue button always ends with the `right` chevron.
- **Ghost:** white pill with a thin Line Strong outline and an indigo label; Lavender Whisper on hover. The other way forward ("Review", "Yes, add a student").
- **Bad:** white pill with a thin Alert Red outline and a red label; Red Tint on hover. A step that removes, declines or clears ("Decline application", "Yes, clear the form").
- **Warn:** white pill with a thin Sunrise Deep (`#b35500`) outline and label; Orange Tint on hover. A step back that can be undone ("Withdraw request").
- **Only Go is filled.** No button is ever filled red; the `destructive` variant of `components/ui/button.tsx` is outlined too.
- **Small:** 36px tall, 16px padding, 14px label, for actions inside a card or a page header.
- **Wide:** full width, at least 52px, 18px label, at the foot of a task card or sheet. A wide ghost that adds something is 64px with 24px corners.
- **Round:** a 44px outlined circle in a guided form (Back, Start over, the brand menu); a 40px outlined circle in the staff top bar (the bell, the Menu button); a 36px borderless circle to close a sheet. Lavender Whisper on hover, scale 0.92 on press.
- **Text link:** indigo, 600, 14px, underlined 3px below ("Edit", "Add", "Clear").
- **Focus:** buttons, choices, links and rows show a 3px indigo outline at 47% (`--gf-focus-ring`), 2px out: 3.16:1 on Paper and 3.07:1 on Lavender Whisper, over the 3:1 a focus ring needs. The guided form draws the same ring everywhere, the public forms included (#403): its choices, round buttons and switch in `guided-form.css`, and `ContinuePill`, `ChangeLink`, `OfferPill`, `InfoButton`, the sheet's close button and the brand menu through `ring-(color:--gf-focus-ring)` (they were 40%, 2.59:1 on Paper). Fields instead turn their outline solid indigo with a 4px ring at 12% (see Inputs). The `orange` button variant of `components/ui/button.tsx` and the Discount code pages' own links and buttons draw it the same way (#451).

### Inputs
- **Pill field:** 52px, thin Indigo Line, Paper, 17px Geist, centred text, orange caret, 20px padding (48px with a field icon, which sits 18px in, Rahmah Indigo). Focus: solid indigo outline and a 4px indigo ring at 12%. Invalid (`aria-invalid="true"`): Alert Red outline and a 4px red ring at 10%, with an error line under the field that folds open, has `role="alert"` and says what to do.
- **Named field** (`NamedField`, owner 26 Nov 2026): the pill field with its icon and a short name inside the box on the left (13.5px Geist 600, Slate Quiet, 46px in, the indigo icon 20px in), so the name stays when the box holds a value; a placeholder can’t, so a Change sheet, whose boxes start filled, uses this. What is typed stays centred, with 100px either side for the name. The name is one short word (Label, Seats) and is the field’s real `<label>`. Hints and errors stay under the box.
- **Password field** (`PasswordField`, design site round, 27 Nov 2026): the pill field with the lock icon at the start and a 36px round eye button inside its right end, Lavender Whisper on hover. Pressed (`aria-pressed="true"`), the password shows and the icon becomes `eye-off`; its name says what pressing does ("Show password", "Hide password").
- **Left-aligned** fields (`alignStart`) for long free text and the search field.
- **Compact field:** 44px, 15px. The top-bar search is 40px, rests on Lavender Chrome and turns Paper on focus, with a 17px search icon 14px in and 40px left padding. Searching opens Applicants with the term.
- Every field has a label: the open question's title, a named field's name inside the box, or an `sr-only` label where the icon and placeholder carry the meaning.
- **Confirmation number** (`ConfirmationNumber`, #503): six 44 × 56 boxes, 16px corners, 8px apart (40 × 52 and 6px under 360px), Geist 600 24px tabular figures, orange caret, the field focus. A filled box gets the stronger line. One digit per box and the next box takes focus; Backspace in an empty box goes back and the arrow keys move; tapping a later box goes to the first empty one, so focus never skips ahead. It sends itself on the sixth digit, or on a paste or SMS autofill (`autocomplete="one-time-code"` on the first box), which spreads across the boxes. Right: the boxes turn green one by one, 70ms apart, then slide together into a 64px outline circle with a faint body, the same mark as a finished form (FinishMark): the Go Green circle draws first, then the tick from its left end. Wrong: red at once, a 420ms shake, then the same outline circle in Alert Red on Red Tint, then the cross, one stroke after the other. No filled discs. The page puts a plain note under it with the next step. Under reduced motion the colours change and the finished mark shows at once, with no drawing. The group has an `sr-only` name and each box is "Digit n of 6".

### Choices
From the Admission form, unchanged:
- **Choice rows** (`ChoiceTiles layout="rows"`): real radios drawn as 60px rows with 20px corners and a 26px tick circle on the right. Selected: indigo with white text and a white tick.
- **Segmented choices** (`layout="two"` and `"four"`): 52px tiles, 16px corners, 8px apart; selected indigo.
- **Default tile** (`DefaultTile`): one 76px tile for the common answer, a small tagline over an Exo 800 italic 26px value.
- **Chip buttons:** 40px pills for many short options; pressed indigo.

### Guided form
The Admission form and the staff flows the prototype shows as guided (registering students and check-in) ask one question at a time through `components/guided-form/`. Small edits on a record (a fee, the father's name, the previous school) stay inline editors inside the record's sheet, as the prototype shows. Its README documents the props.
- **Progress bar:** a sticky row on top of the task card. Back on the left, Start over in its place on the first question, both 44px round. Groups of 6px chips follow, one chip per step, each group led by its number in Exo italic. When a group finishes, its chips close into one bar, a light runs through it, a green tick lands on its end, and the number cheers, throws small bubbles and turns Sunrise Deep (after 820ms in the React `ProgressBar`, which staff pages reuse). An outlined section chip on the right names the group; it hides under 380px.
- **Questions:** the open question is centred, its title in the Question style. Answering folds the card into a summary row (`SummaryRow`): a 28px Lavender Whisper dot with an indigo tick on the left. In the stacked look (`stacked`, used by the Admission form, Register students, Check-in and the kit demo; approved 25 Nov 2026), the question's label (13px, Slate Quiet) sits on the top line with `ChangeLink small` (13px regular, underlined, indigo) aligned right; the answer (16px, 600, Slate Ink, or regular Slate Soft for `none` answers) sits underneath across the full width, with an optional `sub` line (13.5px, Slate Soft) below it. Forms not yet moved to `stacked` keep the two-column layout (#503): label on the left, right-aligned answer and link on the right, stacking where narrow. The folded rows are the review; there is no separate check page. Group titles sit between groups (`GuidedHead`, with an optional right-aligned `aside` link such as `+ Add Student`).
- **Continue:** a wide Go button ending in ›.
- **Finished:** see States.

### Cards
- **Card:** Paper, 24px corners, thin Indigo Line, the Card shadow, 22px × 24px padding (18px under 860px). Card title in the Card title style; an optional caption under it.
- **Task card:** Paper, 40px corners, no outline, the Indigo lift, 30px × 28px padding (32px corners and 24px × 18px padding up to 860px). One per page.
- **Code block** (`CodeBlock`, design site round, 27 Nov 2026): a command or a few lines of settings on Lavender Chrome, 16px corners, a thin Indigo Line, monospace 13px/1.6 in Indigo Night, 14px × 52px × 14px × 16px padding. The code chip's 30px copy button sits 10px in from the top-right corner, on Paper with a thin line. Long lines scroll sideways inside the block. An optional 12px Slate Quiet label above it names a file. Copying confirms with a toast; when the browser refuses the clipboard, the text is selected so it can be copied by hand.
- **Stat card** (`StatCard`, #520): a number card, such as Home's two. Paper, 22px corners, thin Indigo Line (Line Strong on hover), 14px × 14px × 12px × 18px padding. The top row holds an 18px icon, then 8px, then the title (Geist 600 14px, Ink); a long title wraps under its own first word, never under the icon. Round buttons sit on the right of that row, 36px with the 44px target. The number goes under the icon on the left, Exo 800 italic 48.5px, Rahmah Indigo, with its trend beside it (Geist 700 15px: green arrow up, red arrow down, an indigo line for no change). The card's own graph fills the bottom. At rest the icon is indigo in one colour with nothing behind it. Hovering the card, or focusing a button in it, makes the icon active (its detail turns Sunrise Orange) and grows a 32px Lavender Whisper circle behind it, in 280ms; the circle sits outside the layout, so nothing moves. Under reduced motion the circle fades in without growing. The owner asked for the change to stay small and quiet (2026-11-25).

### Lists
- **List row:** 12px gap, 11px vertical padding, a 1px Lavender Mist line between rows (none above the first). An optional 36px Lavender Whisper disc with an 18px icon; the title in Row title style over a Caption; a trailing chip, small button or 16px indigo chevron. A row that opens something is a link or button with Lavender Chrome on hover.
- **Table:** 14px Geist. Headings 12px 600 Slate Quiet, padded 6px × 12px × 10px. Cells padded 12px with a 1px Lavender Mist top line. A row that opens a sheet is focusable, opens with Enter, and gets Lavender Chrome on hover. Money is right-aligned and never wraps. A total row is bold over a thin Indigo Line. Wide tables scroll sideways inside their card.
- **Key-value list:** a grid of `minmax(110px, 0.8fr) minmax(0, 1.4fr)`, 8px × 14px gaps, 14px; the key in Slate Quiet, the value 600. A reason line under a value is 12.5px Slate Quiet.
- **Section:** inside a card or sheet, 14px padding, a 1px Lavender Mist line between sections, a Section title on top.
- **Filter pills:** 36px outlined pills with a 13px indigo label in a row above a list, `aria-pressed`. Pressed: indigo with white Exo 700 italic.

### Chips
One component shows a lead's status wherever staff see it. A chip is a 24px pill, 10px side padding, Geist 600 12px. Each status has one tint with dark text, all at least 4.5:1:

| Chip | Background | Text |
|---|---|---|
| Applied | `#f1f5f9` | `#314158` |
| Visited | Lavender Whisper | Indigo Deep |
| Interviewed | `#fff4ec` | `#9f2d00` |
| Enrolled, and "ok" tags | `#f0fdf4` | `#016630` |
| Declined, and "bad" tags | `#fef2f2` | `#c10007` |
| Waiting, Not known yet | Orange Tint | Sunrise Deep |
| Inactive (closure) | Paper, thin Indigo Line | `#45556c` |
| Archived (closure) | `#e2e8f0` | `#314158` |
| Line (a time, a search term) | Paper, thin Indigo Line | Rahmah Indigo |
| Boys, who a stream takes | `#e3f0ff` | `#0b4c8c` |
| Girls, who a stream takes | `#fde8f1` | `#9c1c5a` |

The lifecycle colours mean only lifecycle. Other tags on a lead (Returning family, Initially declined, Seat priority) use the Line chip, and so does a Mixed stream.

### Notes
A note is a 16px-cornered box, 12px × 14px padding, 14px/1.45 text, with a 16px icon at the start: `NoticeBox` with tone `info` (Lavender Whisper, indigo text), `good` (Green Tint, dark green), `wait` (warm orange tint, dark orange) or `bad` (Red Tint, dark red). In the staff look (the kit's `Note`) it also has a thin line in its own colour: indigo at 28%, green at 38%, orange at 42%, red at 38% (v38). Never filled. A note says one thing and what to do about it.

### Sheets and dialogs
Opening a row's record, a review or a confirmation uses a sheet over a frosted Indigo Night backdrop (40%, 6px blur). Small edits inside an open sheet (a fee, a name, a previous school) open inline in that sheet's body, not as a second sheet. One component, three placements:
- **Bottom** (always on a phone): rises from the bottom, up to 520px wide and 92% of the screen tall, 28px top corners, the Sheet shadow.
- **Centre** (from 720px): a 28px-cornered card in the middle; it settles from 96% scale.
- **Side** (from 720px): 440px wide, 12px from the right, top and bottom of the window, 28px corners; it slides in from the right.

Every sheet has three parts. The **head** stays at the top: the title in the Question style (left-aligned), an optional hint and chips, and a 36px round Close button in the top-right corner, over a 1px Lavender Mist line. The **body** is the only part that scrolls, with a thin Lavender Mist scrollbar and `overscroll-behavior: contain`. The **foot** stays at the bottom, over a 1px Lavender Mist line: the Go button, then the Ghost button, both wide. Escape and the backdrop close it, focus moves to the title on open and returns to the opener on close, Tab stays inside. Opening takes 320ms.

### Menus and popovers
Paper, a thin Indigo Line, 22px corners, the Indigo lift, opening from their button's corner in 180ms (scale 0.96 and 6px drop). The bell's popover is 340px wide (at most the screen less 32px) and lists new requests as list rows with highlighted icons under a Card title.

### Top bar parts
- **Bell:** a 40px round button with the `bell` icon. Unread requests show the orange pip on its top-right corner: a 17px pill, white Geist 700 10.5px number, a 2px white ring. Opening the popover clears the pip.
- **The person:** a 40px outlined pill: a 30px indigo circle with the initials in Exo 800 italic 12px white, then the name (Geist 600 12.5px) over the role (11px Slate Quiet).

### Toasts
A save that closes its sheet confirms with a toast, and a failure can tell of itself with one: a note at the bottom centre with 18px corners, its tone's tint and thin line (as Notes), its tone's 16px icon, Geist 600 13.5px, 10px × 18px padding and a soft indigo shadow. Tones: news (`info`), saved (`good`), warning (`wait`) and failure (`bad`, `role="alert"`; the others are `role="status"`). It rises 20px in 280ms and leaves after 2.6s. It says what happened and anything the person must do next, in one sentence.

### Confetti
Two confetti moments, both skipped under reduced motion. A sent Admission form keeps its existing burst (`components/guided-form/confetti.tsx`: 70 pieces from the success mark over 2.6s, after 820ms) until it moves to v38. A finished staff task bursts from the finish mark once its tick has drawn (`rainConfetti`): a green ring pulses out of the mark, then mixed shapes (strips, squares, dots, triangles, waves and curls) fly out of its centre and flutter down, 60 on a screen under 600px and 85 wider. Colours: orange `#ee7300` and `#ffb066`, indigo `#0900bb` and `#7b73ff`, green `#0f7a3d` and `#4cc38a`, nothing else.

### Brand top bar
Public form pages (the Admission form and the Discount code pages) open with `BrandTopBar` (`components/brand/`) in a 44px | 1fr | 44px grid: the round logo in a 44px circle linking to alrahmahcomplex.or.tz; the badge, a 44px Rahmah Indigo pill in the Label band style reading "AL-RAHMAH SCHOOLS" for parents and "AL-RAHMAH COMPLEX" for code holders, stepping its text down at 380, 330 and 300px; and the 44px outlined Menu button, whose panel holds the Kiswahili | English control and, where the page has a form, a red "Futa fomu yote" that asks once. The page title is an `sr-only` `<h1>`. On a first visit (no `lang` cookie) a language card grows out of the Menu button over a frosted indigo backdrop, waits until the visitor picks a language (a tap outside or Escape leaves it open) and then shrinks straight back into the button, which pops with an orange ring. Sign-in (`/auth`) keeps its own card with the indigo name band.

### Offer and price (Admission form)
The price box sets the full fee on an orange-tint half against the saving on a green-tint half. The limited-time note has a clock icon on the orange tint; an outlined Sunrise Deep pill and ⓘ buttons open a bottom sheet. Every urgency line must be true. No countdowns.

### Icons
One library, set 1 ("Two lines", since prototype v38), drawn for this app. Every staff screen uses it; lucide is left only on the public pages.
- **Grid:** 24 × 24 viewBox, 2px stroke, round caps and joins, no fill on lines. Shown at 20px (16px small; 16px in the sidebar; 18px in a row disc; 19px in the sidebar toggle; 24px on its own).
- **Two lines:** each icon is a main outline and a second detail (for example the calendar and its days, the upload's tray and its arrow). Utility glyphs (back, right, check, plus, x, up) and phone and down are a single line.
- **At rest:** Rahmah Indigo, both lines, never grey (owner, design site round, 27 Nov 2026), whatever the text colour around it. A part that gives its icon its own colour keeps it: a button (white on orange, red, dark orange), a tick, a step dot, a note's or a toast's tone, and anything marked `data-icon-tone="inherit"`. On indigo the icon is white.
- **Active** (hovered, current, inside a pressed button, an open popup or a button that is on, or featured in a row disc): only the detail turns Sunrise Orange, in 280ms; the main line keeps its colour. On indigo the detail turns light orange (`#ffa24d`).
- **Names:** today, checkin, register, applicants, interviews, followups, reapps, agents, promo, groups, fees, seats, discounts, reopen, reports, roles, audit, search, bell, panel, menu, back, right, check, plus, x, reset, alert, info, phone, user, school, house (the Home entry), link, filter, the form parts' down, calendar and upload, the password field's eye and eye-off, Seats' up (Bring up) and pen (the pencil on a stream), pin (the previous school's region field), and tag (a stream's label in a named field). The prototype holds each path. A new icon follows the same grid and splits into a main line and a detail; it is added to the library, never drawn inline in a page.
- Icons are `aria-hidden`; the button or link around them carries the name.

### Illustrations
Line drawings in style C, "Soft circle" (prototype v38), for the moments between work only: nothing to show, waiting, longer work and failure. Never isometric. Working screens (lists, tables, forms, sheets with fields) use line icons, never illustrations.
- **Drawing:** a `0 0 120 100` viewBox. Each picture sits on a Lavender Whisper circle (r 44), with white fills, a 2px Rahmah Indigo line with round caps and joins, one Peach Glow highlight, and Sunrise Orange sparkles.
- **The set** (`components/illustrations`): `search` (a lens with a question mark: nothing matches), `done` (a cup with steam: nothing is due), `inbox` (an empty tray: no requests), `finding` (a lens sweeping a list: loading), `sending` (a paper plane with its trail: longer work) and `oops` (a sad cloud: something went wrong, shown with Try again).
- **Motion:** the lens, cloud and plane bob, the steam rises, the sparkles twinkle and the trail runs, until the picture is removed. Still under reduced motion.
- Shown at 120–170px wide, centred, `aria-hidden`; the words next to them carry the meaning.

## States

### Loading
- **Opening a staff page:** the page's `loading.tsx` draws its own outline in still Lavender Whisper blocks at the real sizes and corners (`SkeletonBlock` from `components/kit`), and `LogoLoader` (`components/brand/logo-loader.tsx`) shows after 300ms where the page title starts. Blocks do not pulse or shimmer.
- **Waiting inside a task** (such as finding a family by Admission Number): the `finding` illustration at 170px (`sending` for longer work) over one Slate Soft 600 line ("Finding the family…"), centred with 90px above and below, `role="status"`.
- **A pressed button** changes its label in the same frame and is disabled until the action answers. A button never turns into a spinner alone.

### Empty
A line illustration at 150px (`search` when nothing matches, `done` when nothing is due, `inbox` when no request waits), a 15px Slate Ink title saying why it is empty, a Slate Quiet line saying how to get something back, and at most one action. It stands where the list would be, inside the same card. Plain, specific words: "No applicant matches. Clear the filter to see everyone."

### Finished
A finished task replaces its form with a task card: the finish mark, a Question-style title saying what happened ("2 students registered"), a hint saying what to do next, the results (each Admission Number on a Lavender Whisper row with 20px corners), any notes, then the next actions. The finish mark is the live Admission form's: an 84px Green Tint circle whose 3px green line draws itself in 700ms, then a 5px tick drawn left to right in 420ms; the confetti bursts from it once the tick ends (see Confetti). Under reduced motion the mark is drawn at once. Inside a sheet, a save that keeps the sheet open shows `SuccessMark`: a check drawing itself in 420ms in a 64px Green Tint disc.

### Error
- A failed read inside a page is a `bad` note in plain words that say what to do: "Leads could not be loaded. Try again in a moment."
- A staff page that fails to render shows `app/staff/error.tsx` in the stage: "This page could not be shown", Try again, Back to the staff area, and "Reference: …" (the error digest). The error's own message is never shown.
- A missing record shows `app/staff/not-found.tsx`. Public `app/not-found.tsx` and `app/error.tsx` say it in Swahili and English at once, with one orange way home.

### Motion
The table gives the timing of each motion; the illustration bob, confetti, the sidebar label roll and the progress bubbles are described with their components. Durations come from the `--gf-*` tokens.

| Moment | Motion |
|---|---|
| Page change | Each block of the page rises 10px and fades in over 460ms. Top-level blocks start 0, 50, 100 and 140ms in; blocks inside a narrow column or a grid start 0, 70, 130 and 180ms in. |
| Hover and colour | 280ms on `cubic-bezier(0.16, 1, 0.3, 1)` (`--gf-ease-out`). |
| Press | Scale 0.92 (round), 0.96 (pill), 0.98 (row) in 140ms. |
| Question folds | 300ms (`--gf-fold`) on the ease-out curve. |
| Sidebar fold and drawer | 460ms; the drawer 420ms. |
| Sheet | 320ms. Popover 180ms. Toast 280ms. |
| Progress group finishes | Bar closes in 420ms; light runs for 1.1s after 120ms; the mark waits 380ms, then its outline circle (faint Green Tint body) draws in 420ms and its tick in 260ms from the left end, with no filled disc (decision 88); under reduced motion the finished mark shows at once; the number cheers for 720ms. |

**The Reduced Motion Rule.** Under `prefers-reduced-motion: reduce` the tokens collapse (fast 1ms, medium 120ms, slow 160ms, fold 0ms, fade 120ms, sidebar 1ms). The page rise, label roll, illustration bob, number cheer, bubbles and confetti are off, and sheets fade in place instead of sliding. Every new animation adds its reduced-motion rule in the same change.

The `motion` library (pinned at 14.6.0) loads only through `MotionProvider` (`components/motion-provider.tsx`) in the staff layout, with `MotionConfig reducedMotion="user"`. CSS transitions do the rest. No parallax, no page-load choreography beyond the rise, no 3D.

### App icon
Only the Admissions Portal's pages carry the web app manifest and the Apple web-app tags; the landing page and the Admission form carry none, so browsers don't suggest installing them (#497). A browser's own "Add to Home Screen" still works on any page. The manifest is in `lib/portal-app.ts`. Every icon is the full Al-Rahmah logo, never the globe-and-book emblem alone. The theme colour is Rahmah Indigo.

## Do's and Don'ts

### Do:
- **Do** put every page on the lavender wash, and every staff page inside the stage with its border on top.
- **Do** use Exo italic for titles, questions, buttons and the current sidebar item, and Geist for everything people read in quantity or type.
- **Do** keep press targets at the sizes in Components: 44px for Go, Ghost and round buttons in a guided form; 40px for top-bar circles and chip buttons; 36px for small buttons and filter pills; sidebar rows never under 24px. The Admission form's 22px `InfoButton` keeps its size, with an invisible hit area 11px wider on every side.
- **Do** make the next step the one Go button: white Exo 600 italic on `#ee7300` (The ShuleFasta Button Rule).
- **Do** ask a task's questions one at a time through the guided form, and let folded answers be the review.
- **Do** open edits and confirmations in a sheet whose title and buttons stay put while its middle scrolls.
- **Do** build every screen from the kit: icon set 1, the line illustrations and the kit's parts. Add a missing part to the kit and the Design system page first (The Kit First Rule).
- **Do** write counts as words in a sentence.
- **Do** add a reduced-motion rule with every animation.

### Don't:
- **Don't** use upright Exo, anywhere.
- **Don't** put two orange buttons on one screen, or dark text on an orange button.
- **Don't** fill a button red, or fill any button but the orange one.
- **Don't** show a count badge in the sidebar, a tab or a page title. The bell's pip is the only unread marker.
- **Don't** show a scrollbar in the sidebar, or cut off one of its entries.
- **Don't** lift more than one card on a page, or use grey shadows.
- **Don't** use lucide or any other icon set on a staff screen, or draw an icon inline in a page.
- **Don't** put an illustration on a working screen, beside a field, or in a card header.
- **Don't** use old shadcn-neutral parts on a staff screen.
- **Don't** draw a part on a screen that the kit lacks, or change a kit part's look in a screen's own CSS.
- **Don't** set typed text below 16px on a phone.
- **Don't** add a colour outside the palette, or style a lead's status outside the status chip.
- **Don't** invent a screen, layout or line of copy the approved prototype does not show; ask for a prototype first (AGENTS.md).
