# Kit

The staff app's components in the Admission form's design language (DESIGN.md, Components), measured from the approved prototype, version 13, with the look of version 38: thin 0.75px lines (`--gf-stroke`), icon set 1, line illustrations, outlined red and dark orange buttons, tinted notes and toasts, and the finish mark. Each component imports `kit.css`; its classes start with `kit-` and read the `--gf-*` tokens from `app/tokens.css`. No hex colour may be written here (`scripts/design-lint.mjs`). No component holds page words: pass every string as a prop.

Import from `@/components/kit`. Every piece, in every state, is on the kit page, `/staff/kit`. Check a change there against the prototype's "Design system" page.

**Quiet text on a tint.** Slate Quiet (`--gf-quiet`) reads 4.5:1 only on white. The kit's quiet text (captions, table headings, keys, hints) reads `--kit-quiet`, and every part the kit tints sets it to Quiet on tint (`--gf-quiet-on-tint`): notes, toasts, the finished state's numbers, hovered and current list rows, a hovered table row that opens, a hovered `ChoiceTiles` row, the highlighted option in a `Select`'s list, a file dragged over the `FilePicker`, the tab track. A box of your own on Lavender Whisper, Chrome or Mist, or on a note's tint, sets it too, and so does a quiet class of the screen's own (`color: var(--kit-quiet, var(--gf-quiet))`):

```css
.ag-read { background: var(--gf-whisper); --kit-quiet: var(--gf-quiet-on-tint); }
```

**Focus ring.** Every kit control's ring is 3px of `--gf-focus-ring`, 2px out (3.16:1 on Paper, 3.07:1 on Lavender Whisper), and so are the guided form's parts (`ChoiceTiles`, the `GuidedTask` controls), from `guided-form.css`, on staff and public pages alike. A screen's own focusable part uses the same token.

## Use this, not that

A staff screen uses only the kit. The old parts are left only for the public pages that still use them.

| Use | Not |
|---|---|
| `Button` (`variant`, `size`, `pending`), `ButtonLink` | `ui/button`, `staff/pending-button`; `variant="bad"` for `ui/button`'s `destructive` |
| `RoundButton` | `ui/button` with `size="icon"` |
| `TextLink` | an underlined `ui/button` `variant="link"` |
| `Field`, `FieldError` | `ui/input`, `auth-fields` |
| `ChoiceTiles`, `DefaultTile`, `ChipButtons` | `ui/radio-group`, `ui/select` for a few short options |
| `Select` | a native `<select>`, `ui/select` |
| `DateField`, `DateTimeField`, `Calendar` | `<input type="date">`, `datetime-local`, `ui/calendar` |
| `TextArea` | `ui/textarea` |
| `Checkbox`, `Switch` | `ui/checkbox` |
| `Tabs` (links), `TabSwitch` (panels on one screen) | hand-made tab links, `FilterPills` as tabs |
| `Pagination` | hand-made page links, Load more |
| `Avatar`, `AvatarGroup` | hand-made initials circles |
| `Tooltip` | a `title` alone on an icon button |
| `StepSlider` | a bare `<input type="range">` |
| `Accordion` | a stack of `Disclosure`s for questions |
| `PersonNameBoxes`, `StudentNameBoxes`, `FatherNameBoxes`, `FullNameBox`, `CodeBox` from the guided form | one free-text name field, a code field without the hyphen |
| `Disclosure` | `ui/collapsible`, `<details>` |
| `FilePicker` | a bare `<input type="file">` |
| `FilterPills` | `ui/button` toggles, tabs |
| `StatusChip`, `Tag` | `components/status-chip`, `ui/badge` |
| `Card`, `TaskCard` | `ui/card` |
| `PageHeader`, `PageActions`, `pageTitle` | the old shell's `HeaderActions` and `HEADER_ACTIONS_ID` |
| `ListRow` | hand-made rows |
| `Table` | `ui/table` |
| `KeyValueList`, `Section` | hand-made `dl` grids |
| `Timeline` | a hand-made list of dated entries |
| `Note` | `ui/alert` |
| `EmptyState`, `LoadingState`, `FinishedState`, `FinishMark` | `staff/empty-state`, `staff/success-mark` on a finished task |
| `SkeletonBlock` | `staff/page-skeleton`'s `Bone`, `ui/skeleton` |
| `Icon` from `@/components/icons` | `lucide-react` |
| `ContinuePill` from the guided form | stays the guided form's own Continue; elsewhere use `Button size="wide" chevron` |
| `Sheet`, `InlineEditor` | `ui/dialog`, `ui/sheet`, `ui/alert-dialog`, `guided-form/bottom-sheet` |
| `Popover`, `PopoverClose` | `ui/popover`, `ui/dropdown-menu` |
| `toast` and `Toaster` from the kit | `toast` from `sonner`, `ui/sonner` |
| `rainConfetti` | the Admission form's `Confetti` (that burst stays on the Admission form until it moves to v38) |

The shell (#322) draws every staff route; ESLint refuses the old parts in every file under `app/staff/` (#332).

## Buttons

```tsx
<Button size="wide" chevron onClick={next}>Continue</Button>
<Button variant="ghost" size="wide" icon="plus">Yes, add a student</Button>
<Button size="small" pending={saving}>{saving ? "Saving…" : "Save"}</Button>
<Button variant="bad" size="wide" onClick={clear}>Yes, clear the form</Button>
<Button variant="warn" size="small" onClick={withdraw}>Withdraw request</Button>
<ButtonLink href="/staff/applicants" size="wide" chevron>Open Applicants</ButtonLink>
<RoundButton icon="back" label="Back" />            {/* 44px; 40 for the top bar, 36 to close a sheet */}
<TextLink onClick={edit}>Edit</TextLink>
```

One `go` button per screen (The One Invitation Rule), and it is the only filled one. `bad` is outlined red, for a step that removes, declines or clears; `warn` is outlined dark orange, for a step back that can be undone. Never fill a button red. `pending` keeps the button focusable, sets `aria-busy` and `aria-disabled`, drops the chevron and refuses clicks and form submits; change the label in the same render. A `RoundButton` hosts its icon's active state on hover: set 1 turns the main line indigo and the detail orange. That state, like a `ListRow`'s featured disc and the date field's calendar while it is open, shows only inside the new shell (`data-shell="new"`) or the kit page (`data-kit`); see `components/icons/icons.css`. Any element can host it with `data-icon-host=""`.

## Fields

```tsx
<Field aria-label="Admission Number" icon="search" invalid={!!error} aria-describedby="no-error" />
<FieldError id="no-error" message={error} />
```

`size`: `full` (52px, 17px), `compact` (44px) or `search` (40px on Lavender Chrome, left-aligned). Compact and search text is 16px under 861px, so iOS does not zoom. `alignStart` for long free text. `FieldError` folds open when it has a message and is a `role="alert"`.

## Form parts

The parts from prototype version 18 (the card "Form parts on the student’s record"). Each works controlled (`value` and its change handler) and uncontrolled inside a plain form (`name` and `defaultValue`), and posts what the native control posts, so no server action changes. Each takes its name from a `<label htmlFor={id}>` the caller places.

```tsx
<label htmlFor="type">Payment type</label>
<Select id="type" name="type" placeholder="Choose a type" options={[{ value: "full", label: "Full payment" }]} />
<DateField id="paid" name="paid_on" max={today} aria-describedby="paid-hint" />   {/* posts "YYYY-MM-DD" */}
<DateTimeField id="at" name="contacted_at" max={now} aria-labelledby="at-label" />  {/* posts "YYYY-MM-DDTHH:MM" */}
<TextArea id="why" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
<Checkbox label="Pre-Form One programme" hint="Its fee is charged on its own." checked={on} onCheckedChange={setOn} />
<Disclosure variant="boxed" label="More options" open={hasError}>…</Disclosure>
<FilePicker id="csv" name="file" accept=".csv,text/csv" required title="Drop the CSV here or choose a file" chooseLabel="Choose file" />
<RoundButton icon="filter" label="Filter Visited applicants" on={filtered} />
```

- **Select:** a 44px pill that opens our own list, as wide as the field, below it or above when there is no room. `placeholder` is the empty field's words, in Slate Quiet so they meet 4.5:1 (#414), and the quiet heading in the list, never a choice. `""` can be a real option ("Anyone"): the field shows the placeholder only when no option has its value. Escape closes the list only, so it works inside a `Sheet` or a `Popover`. It is a combobox with options, not a menu.
- **The date parts' contract:** `onChange(value, { unreadable })` gives "YYYY-MM-DD" (or the datetime-local value), and "" with `unreadable: true` while the field holds text that is not a date. Never save while `unreadable` is true. In a `<form>` the part blocks the submit itself, `noValidate` forms and form actions included (its own submit listener runs before React’s `onSubmit`); a save that is not a form submit, such as a button’s `onClick`, must check `unreadable` itself.
- **DateField:** typed day first (DD/MM/YYYY), with our calendar behind the button; a pasted "2026-09-05" is read too. Half-typed text stays. While the text cannot be read, the field is invalid (its own line, never the browser's bubble, and focus moves to it on submit), and a form that skips validation posts `unreadable:` and the text, which every date action refuses. `min` and `max` grey out days and month arrows and hide "Today" when today is outside them; a typed date outside them is posted as typed, for the server to refuse. Text that is not a date shows "Type the date as day/month/year…" once the person leaves the field.
- **DateTimeField:** the date, then a 104px 24-hour time; "930" becomes "09:30". It posts the datetime-local value, and "" when both halves are empty; a half that is wrong, or missing while the other is filled, shows its own sentence and blocks the submit. `id` goes on the date input, so a `<label htmlFor>` names only that input; name the date and time together by passing the label's id as `aria-labelledby`:

  ```tsx
  <span id="at-label">Contacted at</span>
  <DateTimeField id="at" name="contacted_at" aria-labelledby="at-label" />
  {/* the group is "Contacted at"; its inputs are "Date" and "Time, 24-hour clock" */}
  ```
- **Calendar:** the month grid open in a box, `mode="day"` or `"week"`. `onPick` gets the clicked day; a caller that keeps weeks turns it into its Monday (`mondayOf` in `dates.ts`).
- **Checkbox and Switch:** with `label`, the whole row is the target; without it, name the box with a `<label htmlFor={id}>`. A tick box is saved with its form; a switch takes effect at once, with no Save button.
- **Disclosure:** `plain` (chevron first) or `boxed`. `open` opens or closes it from outside; the person can still fold it after. Closed content is inert; a field inside that stops its form from being sent opens it.
- **FilePicker:** a real file input inside the area, so `required` and the form's post work. Drop a file on it or press Choose file.
- They are built on the primitives themselves (base-ui Select, Checkbox, Switch and Popover; react-day-picker), not on `components/ui/*`, on purpose: those files carry lucide icons and shadcn styles the kit cannot use. Do not swap them back.
- These parts carry their own fixed words (the two messages, the calendar's names) in `DATE_WORDS`; pass `words` to change one.

What the browser no longer checks for you, so the server's own refusal (already there) is what holds:

| Part | Attribute | In the browser |
|---|---|---|
| `DateField`, `DateTimeField` | `min`, `max` | Grey out days in the calendar only. A typed date outside them is posted as typed. |
| `DateField`, `DateTimeField` | `required` | Holds the form with the browser's own message while the field is empty, as a kit `Field` does. |
| `DateField`, `DateTimeField` | text that is not a date | Holds the form with the part's sentence, `noValidate` forms included (see the contract above). |
| `Select` | `required` | Holds the form, moves focus to the pill and gives it the invalid look (`aria-invalid`) until a choice, as the prototype does; no sentence. A caller's own `invalid` wins. |
| `Select` | `size` | None: one 44px size (version 18). |
| `FilePicker` | `accept` | Filters the file dialog; a dropped file of another type is still taken. |

Under reduced motion the popups appear at once and the tick and chevrons do not move.

## Picked parts (prototype v38)

The parts the owner picked on v38's Design system page (#402). Their styles are in `picked.css`.

```tsx
<Tabs label="Application sections" tabs={tabs} current={href} scroll={false}><TextLink>Clear search</TextLink></Tabs>
<TabSwitch label="Charts" tabs={[{ value: "week", label: "This week", panel: <WeekChart /> }]} value={tab} onChange={setTab} />
<Pagination label="Applicant pages" page={page} pageCount={12} href={(p) => `/staff/applicants?page=${p}`} previousLabel="Previous page" nextLabel="Next page" pageLabel={(p) => `Page ${p}`} />
<Avatar initials="RM" name="Rehema M." size={40} tone="orange" />
<AvatarGroup people={people} label="Rehema M., Asha Saidi and 5 others" />
<Tooltip label="New requests"><RoundButton icon="bell" label="New requests" /></Tooltip>
<StepSlider min={0} max={25} step={5} value={percent} onValueChange={setPercent} unit="%" aria-label="Discount, percent" />
<Accordion items={[{ title: "Who sees the family’s Discount code?", content: <p>…</p> }]} />
```

- **Tabs C, sliding track:** equal tabs on a Lavender Whisper track; one indigo pill slides to the chosen one (at once under reduced motion). `Tabs` are links, for a page's sections or a search param; the pill moves on the click, before the page arrives. `TabSwitch` is a tablist with one panel, for sections inside one screen. Left and Right arrows, Home and End move along both; in `TabSwitch` they choose the tab too. A long label is cut with an ellipsis, so keep labels short.
- **Pagination A, numbered pills:** for a list longer than 10 rows. At most seven places: the first and last page always, `…` for the rest (`pageWindow`). `href` makes links (a server page); `onPage` makes buttons (a client part). Nothing shows for one page.
- **Avatars B, soft tints:** `indigo`, `orange` or `green`; sizes 24, 32, 40 and 56. `AvatarGroup` stacks 36px avatars in those tints in turn, then "+3".
- **Tooltips A, light:** white, the thin line, the soft shadow, above the button on hover and keyboard focus; Escape hides it. It removes the button's `title`, so the browser's own tooltip does not show too. The button keeps its name.
- **Slider B, steps with labels:** a native range input, each step's value under the track. Write the chosen value in words beside it.
- **Accordion A, separate cards:** one open at a time; each question is a heading (`headingLevel`, 3 by default) holding its button.
- **Stepper A, chip bar:** the guided form's `ProgressBar` (see `components/guided-form/README.md`); a staff task gets it through `GuidedTask`.
- **Name boxes and the code box** are the guided form's (`components/guided-form/README.md`, Name boxes and the code box), so the public forms use them too.

## Choices and filters

`ChoiceTiles` and `DefaultTile` are the Admission form's own (see `components/guided-form/README.md`); `big` gives the 56px Exo tile the kit page shows. `ChipButtons` (40px) and `FilterPills` (36px) are toggle buttons with `aria-pressed` in a named group:

```tsx
<FilterPills label="Filter by status" options={statuses} value={filter} onChange={setFilter}>
  <TextLink onClick={clear}>Clear</TextLink>
</FilterPills>
```

When the filter is a page or a search param, give each option an `href` and pass `current` (the href on screen, or `null`) instead of `value` and `onChange`. The pills are then links in a `<nav>` named by `label`, so the filter works without JavaScript and Back returns to it; the current one has `aria-current="page"` and the pressed look. Use it rather than `Tabs` when there are many filters or long labels, which the equal tabs would cut.

```tsx
<FilterPills label="Agent status" options={[{ label: "Pending", href: "/staff/agents" }, { label: "Retired (3)", href: "/staff/agents?status=retired" }]} current={href}>
  <Link href={clearHref}>Clear search</Link>
</FilterPills>
```

## Chips

`StatusChip status="Visited"` for a lead's status or closure mark, the only place a status is styled. `Tag tone="wait" | "ok" | "bad" | "line"` for everything else; other tags on a lead use `line`.

## Cards, header and lists

```tsx
export const metadata = { title: pageTitle("Applicants") }

<PageHeader title="Applicants" subtitle="Every student, from Applied to Enrolled." actions={<ButtonLink href="…" size="small" chevron>Register students</ButtonLink>} />
<Card title="Needs you today">
  <ListRow icon="interviews" title="3 interviews today" caption="The first is at 10:00" href="/staff/interviews" />
</Card>
```

Cards side by side go in a `Bento` (prototype v40, Design system): every card in a row is as tall as the tallest, its content at the top, and a short last row fills the width, so no hole is left. It takes one column, two from 580px of its own width and three from 880px; `columns={2}` stops at two. A card with `data-bento="full"` spans the row. Put full cards first or last, or start a new `Bento` after one (back-to-back grids sit 14px apart, like one grid). The last row counts only the cards that show: a full, hidden or empty card is left out, and an empty card takes no place.

```tsx
<Bento columns={2}>
  <Card title="Student" data-bento="full">…</Card>
  <Card title="Parent or guardian">…</Card>
  <Card title="Family">…</Card>
</Bento>
```

`PageHeader` is the page's one `h1`. A client part deeper down adds an action to its slot with `<PageActions>`. A `Card` with a title is a region named by it. `TaskCard` is the one lifted card on a page.

`ListRow` is a link with `href`, a button with `onClick`, a plain row otherwise; `icon` draws the featured disc, `leading` takes a Line tag instead. `Table` takes `columns` (`header`, `cell`, `align: "end"` for money, `rowHeader` for the cell that names its row, such as a name) and `rows`; `onOpen` makes rows focusable, opened by click or Enter, named by `rowLabel`. `total` adds the bold total row. `KeyValueList` items take a `reason` line and `numeric`. `Section` heads a part of a card or sheet. `Timeline` lists what happened, newest first, as the prototype v38 Design system page draws it: each item has a `title`, a `meta` line (who and when), an optional `tone` (`ok` green, `wait` orange; indigo otherwise) and children below, such as the fields an edit changed; `label` names the list. `Note tone="info" | "good" | "wait" | "bad"` takes a `role`: `status` for news, `alert` for a failure. Each tone is a faint tint with a thin line in its own colour.

## States

- `EmptyState` (title, hint, at most one action), inside the card where the list would be. `illustration`: `search` when nothing matches (the default), `done` when nothing is due, `inbox` when no request waits, `oops` for a failure with Try again.
- `LoadingState label="Finding the family…"` while a task waits; `role="status"`. `illustration="sending"` for longer work such as a batch.
- `FinishedState` inside a `TaskCard`: the finish mark, title, hint, `results` (Admission Numbers), then notes and the next actions as children.
- `FinishMark` is that mark on its own: the live Admission form's 84px green circle, drawn, then its tick left to right. Pass it (its `ref`) to `rainConfetti`.
- The pictures are `Illustration` from `@/components/illustrations`: line drawings in style C, "Soft circle", never isometric. They move until removed and stand still under reduced motion.
- `SkeletonBlock` builds a page's `loading.tsx`: still Lavender Whisper blocks at the real sizes (`shape="pill"` or `"card"`), inside an element with `role="status"` that names what is loading.

## Guided form

A staff task that asks one question at a time (registration, check-in) uses the Admission form's engine inside `GuidedTask`. The questions are `GuidedStack`, `GuidedStep`, `GuidedHead`, `SummaryRow`, `QuestionTitle`, `Hint` and `ContinuePill` from `@/components/guided-form` (see its README); the fields, choices, notes and links are the kit's.

```tsx
<GuidedTask
  progress={{ groups, activeGroup, canBack, onBack, canReset, onReset, labels: { back: "Back", reset: "Start over" }, status }}
  finished={saved ? { title: "2 students registered", hint: "Give the family these Admission Numbers.", results, children: actions } : null}
>
  <GuidedStack>
    <GuidedHead key="h:s0" aside={<TextLink onClick={remove}>Remove</TextLink>}>Neema Juma Salim Mrisho</GuidedHead>
    <GuidedStep key="s0.cls" state="folded" summary={<SummaryRow label="Class" value="STD 5" action={<TextLink onClick={change}>Change</TextLink>} />}>…</GuidedStep>
  </GuidedStack>
</GuidedTask>
```

- The task card sits in a 640px centred column. The progress bar sticks to the top of the stage's scroll area, with Back and Start over drawn with the set 1 icons (Start over's arrow turns orange on hover; Back is a plain chevron).
- The stage's scroll area sets `--kit-stage-pt` to its top padding and carries `data-stage-scroll`; `revealStep` then scrolls it instead of the window. Without them the bar sticks to the window's top.
- `finished` swaps the card for `FinishedState`: its title takes focus, the finish mark draws, and `rainConfetti` bursts from it once. Wait 950ms after the save before setting it, so the last group's cheer plays first.
- `GuidedReveal open` unfolds part of an open question once the answers before it allow (a phone field after a choice, Continue once the question is complete); closed, it takes no space and is inert.
- Reduced motion: folds are instant with a 120ms fade; the cheer, bubbles and confetti are off.

The kit page's "Guided form" card plays a registration with the prototype's questions.

## Sheets

```tsx
<Sheet
  open={open}
  onOpenChange={setOpen}
  placement="centre"
  title="Sibling · 10%"
  hint="Latifa Omari Juma Hassan"
  closeLabel="Close"
  foot={
    <>
      <Button size="wide" chevron onClick={grant}>Grant the discount</Button>
      <Button variant="ghost" size="wide" onClick={refuse}>Refuse</Button>
    </>
  }
>
  <Note tone="wait">…</Note>
</Sheet>
```

`placement`: `centre` for a review or a confirmation, `side` for a row's record, `bottom` to rise from the bottom everywhere. Under 720px every sheet rises from the bottom. The head (title, `hint`, `chips`, Close) and the foot stay put; only the children scroll. Focus moves to the title, Tab stays inside, Escape and the backdrop close it, and focus returns to whatever opened it. The body joins the tab order only while it scrolls, so the keyboard can scroll a long body and a confirmation whose words are all in `hint` goes from Close straight to its foot. On a phone the foot follows `visualViewport`, so it stays above the keyboard. `hintId` gives the hint an id, so a field in the sheet can point at it with `aria-describedby`. Keep the sheet mounted and drive `open`, so it can slide out; remount it with a `key` to start a form afresh. A `KeyValueList` in a sheet keeps 14px above and below it, as the prototype's does.

A small edit on the record opens inline in the sheet's body, not as a second sheet:

```tsx
{editing && (
  <InlineEditor saveLabel="Save" cancelLabel="Cancel" onSave={save} onCancel={() => setEditing(false)}>
    <Field size="compact" autoFocus aria-label="Father’s full name" … />
    <FieldError id="father-error" message={error} />
  </InlineEditor>
)}
```

It draws the dashed line and the small Save and Cancel; when it closes, focus goes back to the link that opened it.

## Menus and popovers

```tsx
<Popover trigger={<RoundButton icon="bell" label="New requests" size={40} />} title="New requests" closeLabel="Close">
  <ListRow icon="discounts" title="New discount request" caption="…" onClick={open} />
</Popover>
<Popover size="narrow" trigger={<button …>…</button>} title="Rehema M." description="Admissions Manager" closeLabel="Close">
  <PopoverClose render={<Button variant="ghost">Sign out</Button>} />
</Popover>
```

`size`: `wide` 340px (the bell), `narrow` 230px (the account menu). It opens below its button, aligned to its end. Rows sit straight under the title, round to 14px on hover and drop the link chevron. Tab stays inside; Escape or a click outside closes it and focus returns to the button. `closeLabel` names a Close that only screen readers see.

## Toasts and confetti

```tsx
toast("Fee saved. The change and its reason are in the audit log.", { tone: "good" })
toast("The batch stopped early. Its report shows how far it got.", { tone: "bad" })
rainConfetti(markRef.current)
```

`toast` shows one sentence at the bottom centre for 2.6s, at most half the window wide, so on a phone it wraps; a new one replaces it. `tone` is the note's: `info` (the default) for news, `good` for a save, `wait` for a warning, `bad` for a failure, which is read out as an alert. Each is a faint tint with a thin line and its icon. It goes to the kit's `Toaster`, which the shell mounts once; the public pages' toasts keep their look. `rainConfetti(mark)` waits for the finish mark's tick, then bursts from its centre: 60 pieces under 600px, 85 wider, mixed shapes in orange, indigo and green only. Without a mark it finds the last one on the screen. Both, and every sheet, honour reduced motion: sheets fade in place, the toast does not rise, the mark is drawn at once and there is no confetti.
