# Kit

The staff app's components in the Admission form's design language (DESIGN.md, Components), measured from the approved prototype, version 13. Each component imports `kit.css`; its classes start with `kit-` and read the `--gf-*` tokens from `app/tokens.css`. No hex colour may be written here (`scripts/design-lint.mjs`). No component holds page words: pass every string as a prop.

Import from `@/components/kit`. Every piece, in every state, is on the kit page, `/staff/kit`. Check a change there against the prototype's "Design system" page.

## Use this, not that

A converted staff screen uses only the kit. The old parts stay for screens that have not converted yet.

| Use | Not |
|---|---|
| `Button` (`variant`, `size`, `pending`), `ButtonLink` | `ui/button`, `staff/pending-button` |
| `RoundButton` | `ui/button` with `size="icon"` |
| `TextLink` | an underlined `ui/button` `variant="link"` |
| `Field`, `FieldError` | `ui/input`, `auth-fields` |
| `ChoiceTiles`, `DefaultTile`, `ChipButtons` | `ui/radio-group`, `ui/select` for a few short options |
| `FilterPills` | `ui/button` toggles, tabs |
| `StatusChip`, `Tag` | `components/status-chip`, `ui/badge` |
| `Card`, `TaskCard` | `ui/card` |
| `PageHeader`, `PageActions`, `pageTitle` | the old shell's `HeaderActions` and `HEADER_ACTIONS_ID` |
| `ListRow` | hand-made rows |
| `Table` | `ui/table` |
| `KeyValueList`, `Section` | hand-made `dl` grids |
| `Note` | `ui/alert` |
| `EmptyState`, `LoadingState`, `FinishedState` | `staff/empty-state` |
| `SkeletonBlock` | `staff/page-skeleton`'s `Bone`, `ui/skeleton` |
| `Icon` from `@/components/icons` | `lucide-react` |
| `ContinuePill` from the guided form | stays the guided form's own Continue; elsewhere use `Button size="wide" chevron` |

Sheets, menus, popovers, toasts and confetti come with #320; the guided form on staff pages with #321; the new shell with #322.

## Buttons

```tsx
<Button size="wide" chevron onClick={next}>Continue</Button>
<Button variant="ghost" size="wide" icon="plus">Yes, add a student</Button>
<Button size="small" pending={saving}>{saving ? "Saving…" : "Save"}</Button>
<ButtonLink href="/staff/applicants" size="wide" chevron>Open Applicants</ButtonLink>
<RoundButton icon="back" label="Back" />            {/* 44px; 40 for the top bar, 36 to close a sheet */}
<TextLink onClick={edit}>Edit</TextLink>
```

One `go` button per screen (The One Invitation Rule). `pending` keeps the button focusable, sets `aria-busy` and `aria-disabled`, drops the chevron and refuses clicks and form submits; change the label in the same render. A `RoundButton` hosts its icon's active state on hover. That state, like a `ListRow`'s featured disc, shows only inside the new shell (`data-shell="new"`) or the kit page (`data-kit`); see `components/icons/icons.css`.

## Fields

```tsx
<Field aria-label="Admission Number" icon="search" invalid={!!error} aria-describedby="no-error" />
<FieldError id="no-error" message={error} />
```

`size`: `full` (52px, 17px), `compact` (44px) or `search` (40px on Lavender Chrome, left-aligned). Compact and search text is 16px under 861px, so iOS does not zoom. `alignStart` for long free text. `FieldError` folds open when it has a message and is a `role="alert"`.

## Choices and filters

`ChoiceTiles` and `DefaultTile` are the Admission form's own (see `components/guided-form/README.md`); `big` gives the 56px Exo tile the kit page shows. `ChipButtons` (40px) and `FilterPills` (36px) are toggle buttons with `aria-pressed` in a named group:

```tsx
<FilterPills label="Filter by status" options={statuses} value={filter} onChange={setFilter}>
  <TextLink onClick={clear}>Clear</TextLink>
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

`PageHeader` is the page's one `h1`. A client part deeper down adds an action to its slot with `<PageActions>`. A `Card` with a title is a region named by it. `TaskCard` is the one lifted card on a page.

`ListRow` is a link with `href`, a button with `onClick`, a plain row otherwise; `icon` draws the featured disc, `leading` takes a Line tag instead. `Table` takes `columns` (`header`, `cell`, `align: "end"` for money) and `rows`; `onOpen` makes rows focusable, opened by click or Enter, named by `rowLabel`. `total` adds the bold total row. `KeyValueList` items take a `reason` line and `numeric`. `Section` heads a part of a card or sheet. `Note tone="info" | "good" | "wait" | "bad"` takes a `role`: `status` for news, `alert` for a failure.

## States

- `EmptyState` (title, hint, at most one action), inside the card where the list would be.
- `LoadingState label="Finding the family…"` while a task waits; `role="status"`.
- `FinishedState` inside a `TaskCard`: title, hint, `results` (Admission Numbers), then notes and the next actions as children.
- `SkeletonBlock` builds a page's `loading.tsx`: still Lavender Whisper blocks at the real sizes (`shape="pill"` or `"card"`), inside an element with `role="status"` that names what is loading.
