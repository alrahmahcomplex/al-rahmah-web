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
- `endReset`: from the second question on, Back keeps the left slot and Start over shows after the section chip (#511, v50). Pass `canReset` with it.
- `kitIcons` (staff pages, set by the kit's `GuidedTask`) draws Back and Start over with the set 1 icons as icon hosts. The public forms leave it off.

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
| `ChoiceTiles` | Radios; `layout="rows"` (Day/Boarding, tick on the right), `"two"` (year), `"four"` (relationship), `"pair"` (two big tiles with a line under each label: the custodian's The father / Someone else, #511) | `.choice`, `.seg`, `.cpk` |
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
| `SwitchRow` | A whole-row switch with a small line under its label ("The father is the custodian", with his three names): a real checkbox, `role="switch"`. Tinted Whisper with an indigo line while on. The kit's `Switch` needs kit.css, so public pages use this one | `.swt.swrow` |
| `Reveal` | A part that folds open and shut (`open`), `inert` while shut, such as the custodian's name boxes under the switch | `.rv` |
| `TypeAheadField` | One option from a list (#511, v53): a faint match after the typed letters, taken with → at the end, Tab or Enter (Space when one fits); the arrow opens the list below the box, over the page, with a search box. `pinned` draws the first option with a line under it; `lead` and `optionLead` draw a pin or a flag. `value` is empty until a whole option is typed or picked. The list always opens downward: the box scrolls up first, room is added at the page's foot when needed, and under a phone keyboard the list is never taller than the room left. Tab in the list's search takes the faint match and moves to the next field; Shift+Tab goes back. A polite live region says the faint match, which is drawn and not in the box | `acField`, `.acw`, `.acp` |
| `useKeepFocusInView` | Mount once on a form page: on a phone, the box that gets the caret (Space or Enter in the name boxes) is brought above the keyboard (#511, v54). `keepInView(el)` does it once | `keepInView` |

**Focus ring.** Every part here draws 3px of `--gf-focus-ring` (indigo at 47%), 2px out: 3.16:1 on Paper and 3.06:1 on Lavender Whisper. The choices, round buttons and switch get it from `guided-form.css`; the pills and links from `ring-(color:--gf-focus-ring)`.

`prefersReducedMotion()`, `foldMs()` and `buzz()` are exported for page code that times its own steps. The prototype's card frame (`.card`, 32px corners on phones, 40px from 640px, Indigo lift) and the lavender page wash stay with the page: use Tailwind there.

## Name boxes and the code box

Prototype v38. They live here, not in the kit, so the public forms (#403, #404) and the staff screens import the same parts and no public page loads the kit's stylesheet. Field names follow the names contract on #400.

```tsx
const LABELS = { first: "First name", middle: "Middle name", last: "Last name" }

<PersonNameBoxes aria-labelledby={titleId} labels={LABELS} value={person} onChange={setPerson} invalid={{ lastName: !person.lastName }} aria-describedby="name-error" />
<StudentNameBoxes aria-labelledby={titleId} labels={{ ...LABELS, student: "Student’s name", father: "Father’s name" }} />
<FullNameBox name="brought_by_name" aria-label="Their full name" />   {/* check hasTwoNames() before saving */}
<CodeBox name="code" aria-label="Discount code" placeholder="Discount code, e.g. ABC-123" />
```

| Part | Layout | Posts |
|---|---|---|
| `PersonNameBoxes` | First across, Middle and Last side by side (an agent, a custodian) | `firstName`, `middleName`, `lastName` |
| `FatherNameBoxes` | First and Middle side by side, Last across | `fatherFirst`, `fatherMiddle`, `fatherLast` |
| `StudentNameBoxes` | The student's name across, then the "Father's name" group in the father layout | `firstName`, `fatherFirst`, `fatherMiddle`, `fatherLast` |
| `FullNameBox` | One box, spaces kept ("Who brought the students") | its `name` |
| `CapitalsBox` | One box in capitals, spaces kept: a previous school's name (#511, v52) | its `name` |
| `LastNameChoice` | Which of the father's names is the student's last name (#511, v50): two tiles showing the name each gives, folding open once his middle and last names are typed, his last name picked to start with. Put it under `StudentNameBoxes` | its `name` (`father_last` or `father_middle`) |
| `CodeBox` | The Admission form's box, for an agent's code or a Promo code: capitals, no spaces; three letters followed by a digit get the hyphen between them (AAN132 → AAN-132) and a hyphen typed again there is dropped; anything else, such as a Promo code (SAVE10, KARIBU2026, AS-135, $AVE), stays as typed; at most 20 characters | its `name` |
| `AgentCodeBox` | An agent's code only, ABC-123: three letters, the hyphen by itself, three digits; anything else is dropped and a repeated hyphen ignored | its `name` |
| `CodePicker` | `CodeBox` with an arrow that opens the codes to pick from under a search box, Promo codes first, then agent codes, each A to Z, and a faint completion of the first listed code the typed letters begin (Tab or → takes it). The list opens in the page's flow, pushing what follows down. Register Students reads the list from `usable_discount_codes` | nothing; the caller keeps `value` |

```tsx
<CodePicker value={code} onValueChange={setCode} options={codes} listState="ready" aria-label="Discount code" placeholder="Discount code, e.g. ABC-123" />
```

- **The labels are the placeholders**, inside the boxes, and each box's name for a screen reader. Never put a label above them. Name the group with `aria-labelledby` (the question's title).
- **Typing:** capitals; Space ends a box and moves to the next, a pasted full name spreads across the boxes, Backspace in an empty box goes back to the one before, Enter moves on instead of sending the form. The last box keeps its spaces (BIN SALIM). While a phone keyboard is composing a word, nothing changes until the word is done.
- Every box is `required` unless `required={false}`. `names` changes what a box posts as, such as `students[0][firstName]`; `value` and `onChange` take the contract's object. The last box can end in a space while typing: save `cleanName(value)`.
- A Promo code of three letters then a digit (EID2026) gets the hyphen too. A lookup that takes both kinds of code tries the code as typed, then without that hyphen; the database never holds two codes that differ only by it (`discount_code_key`).
- `typeInNameBox`, `cleanName`, `hasTwoNames`, `formatCode` and `formatAgentCode` are the plain rules, for a server check or a test.
