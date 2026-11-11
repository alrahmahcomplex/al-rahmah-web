# Guided form and brand top bar (concept C)

React ports of the approved prototype (`c2.html` in the UX scratchpad, v2.10). Each component imports `guided-form.css`, which holds the keyframes and reduced-motion rules; it reads the tokens (`--gf-*`) from `app/tokens.css`, which the root layout loads. All classes there start with `gf-`. No component holds page words: pass every string as a prop, or take it from `components/brand/copy.ts`.

Import from `@/components/guided-form` and `@/components/brand`. The server helper `languagePromptNeeded` comes from `@/components/brand/language-cookie`.

## Brand top bar

```tsx
// Server page
import { languagePromptNeeded } from "@/components/brand/language-cookie"
const showPrompt = await languagePromptNeeded()

// Client form
<BrandTopBar variant="schools" language={language} showLanguagePrompt={showPrompt} onClearForm={clearEverything} />
<h1 className="sr-only">Fomu ya Udahili</h1>
```

| Prop | Meaning |
|---|---|
| `variant` | `"schools"` (parents, `/apply`) or `"complex"` (staff and code holders) |
| `language` | Current page language; the menu marks it pressed |
| `onClearForm?` | Adds "Futa fomu yote" with its confirm step; called after "Ndiyo, futa". Clear the draft here too |
| `showLanguagePrompt?` | Renders `LanguagePrompt` wired to the menu button |
| `labels?` | Overrides for `BRAND_COPY[language]` |
| `menuButtonRef?` | Pass your own ref if you render `LanguagePrompt` yourself |

The language control posts to `setLanguage`, so the page re-renders through the cookie and the form keeps its React state. `BrandTopBar` includes `DocumentLanguage`, so drop the old `LanguageSwitch` from the page. Prototype CSS: `.top2`, `.markl`, `.mark`, `.badge`, `.menuwrap`, `.menu`, `.mitem`, `.mconfirm`.

`LanguagePrompt` (`.lp`, `.lp-*`, `.ld-*`) reads `show` once, on mount, and finishes its confirmation even after the server stops sending `show`. `catchMenuButton(el)` plays the menu button's pop and orange ring (`.menubtn.catch`).

## Progress bar

```tsx
<ProgressBar
  groups={[{ label: "Mwanafunzi", steps: 3, done: 2 }, { label: "Msimamizi", steps: 3, done: 0 }, { label: "Usaili", steps: 2, done: 0 }]}
  activeGroup={0}
  whoLabel={children.length > 1 ? "Mwanafunzi wa pili" : undefined}
  canBack={index > 0} onBack={goBack}
  canReset={index === 0 && nothingAnswered} onReset={startOver}
  labels={{ back: "Rudi", reset: "Anza upya" }}
  status="Mwanafunzi: hatua 3 kati ya 3"
/>
```

- `done` fills chips from the left; `current` (default `done` in the active group) draws the faint chip. Pass `current` when the parent reopens an earlier step.
- A group whose `done` reaches `steps` merges, gets the green tick and, 820 ms later, the number cheers (pop, shake, bubbles, deep orange). A group already full on first paint shows the orange number without the cheer.
- `activeGroup` past the last group (the send step) keeps the last label in the chip. Hide the whole bar on the success screen.
- `status` goes to an `aria-live="polite"` line; build it with the page's words.
- `kitIcons` (staff pages, set by the kit's `GuidedTask`) draws Back and Start over with the set 2 icons as icon hosts. The public forms leave it off.

Prototype CSS: `.bar-row`, `.navslot`, `.backbtn`, `.resetbtn`, `.prog`, `.pg`, `.who`, `.gn`, `.chip`, `.liquid`, `.ok`, `.secname`.

## Folding stack

```tsx
<GuidedStack>
  <GuidedHead key="h:students">Mwanafunzi</GuidedHead>
  <GuidedStep
    key="name:1"
    state={open === "name:1" ? "open" : "folded"}
    summary={done.has("name:1") && <SummaryRow label="Jina kamili la mwanafunzi" value={name} action={<ChangeLink onClick={() => openStep("name:1")}>Badilisha Jina</ChangeLink>} />}
    onOpened={(li) => { li.querySelector("input")?.focus({ preventScroll: true }); revealStep(li) }}
  >
    <QuestionTitle htmlFor="f-name">Mwanafunzi anaitwa nani?</QuestionTitle>
    <FieldInput id="f-name" value={name} onChange={...} aria-describedby="e-name" />
    <FieldError id="e-name" message={error} />
    <ContinuePill onClick={next}>Endelea</ContinuePill>
  </GuidedStep>
</GuidedStack>
```

- Render a step only once it is reached; render it open or folded after that. Keep the body rendered while folded so the fold can animate.
- Children of `GuidedStack` need stable `key`s. A removed child folds shut before it leaves; a new one unfolds. Pass `instant` for a full restart.
- The hidden half of a step is `inert`, so Tab reaches only the open question and the Change links.
- `onOpened(li)` runs after a step opens again (and on first paint with `openOnMount`). Focus the field there, or the `QuestionTitle` (it has `tabIndex={-1}` and takes a `ref`). `revealStep(li)` scrolls it into the top third: of the window, or of the nearest `data-stage-scroll` element on a staff page.
- `GuidedNote` holds a free row such as a `NoticeBox` or a student's folded line.

Prototype CSS: `.stack`, `.item`, `.step`, `.sum-w`, `.fold`, `.settled`, `.head`, `.note`, `.body`, `.sum`.

## Controls

| Component | Use | Prototype |
|---|---|---|
| `SummaryRow` | Folded answer: tick dot, label over value, action on the right | `.sum` |
| `ChangeLink` | Two-word "Badilisha …" button; give it an `aria-label` naming the student when there are several | `.btn-text` |
| `QuestionTitle` | Centred Exo italic question; `htmlFor` makes it the field label | `h2.q` |
| `Hint` | Grey help line | `.hint` |
| `FieldInput` | Pill input, 52px, centred text; `invalid`, `icon`, `alignStart` | `.input` |
| `FieldError` | Red line that folds open under a field | `.err` |
| `ChoiceTiles` | Radios; `layout="rows"` (Day/Boarding, tick on the right), `"two"` (year), `"four"` (relationship) | `.choice`, `.seg` |
| `DefaultTile` | One-tap answer with tagline, e.g. FORM 1 with "Wazazi wengi huchagua" | `.pop` |
| `ContinuePill` | Orange "Endelea ›" (`variant="go"`, chevron always added) or outlined (`variant="ghost"`, `icon="plus"` for "Ndiyo, ongeza mwanafunzi"); `pending` shows a spinner | `.btn-go`, `.btn-ghost` |
| `NoticeBox` | `tone` good, wait, bad or info; optional `role` | `.notice` |
| `OfferNote` | Clock, title, body on orange tint; `pulse` for the entrance, `centred` on the success screen | `.offer` |
| `OfferPill` | "OFA YA MUDA MAALUM" pill (CSS uppercases it) that opens the sheet | `.offerpill` |
| `InfoButton` | ⓘ beside a discounted fee; `label` is its aria-label | `.ibtn` |
| `PriceAnchor` | Full fee vs saving. Leave `saving` and `was` out until the live route answers | `.anchor` |
| `BottomSheet` | Modal sheet: `open`, `onClose`, `title`, `closeLabel`. Focus trap, Escape, backdrop, scroll lock, focus return | `.sheet-wrap`, `.sheet` |
| `Confetti` | Mount it on the success screen; `originRef` is the success tick. Skipped under reduced motion | `confetti()` |
| `LiveCountPill` | The application count; change `bumpKey` when the number changes | `.live-n.blk` |
| `Icon` | The prototype's line icons by name | `icon()` in core.js |

`prefersReducedMotion()`, `foldMs()` and `buzz()` are exported for page code that times its own steps. The prototype's card frame (`.card`, 32px corners on phones, 40px from 640px, Indigo lift) and the lavender page wash stay with the page: use Tailwind there.
