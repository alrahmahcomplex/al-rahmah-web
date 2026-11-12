# Form parts waiting for #358

The kit has no choice list, date field, day picker, tick box, disclosure or filter button yet. Ticket #358 (Redesign F7) brings them. Until it merges, a converted screen reaches each of these through one file here, which draws today's control with today's value format. When #358 lands, each file's inside changes to the kit part and nothing that imports it changes.

These files sit outside every route folder, so the import guard in `eslint.config.mjs` does not refuse their old parts. Nothing else may import `components/ui` on a converted screen's behalf.

| File | Today's control | What the callers expect |
|---|---|---|
| `choice-list.tsx` `ChoiceList` | native `<select>` | `options` as `{ value, label }` in order; either `name` + `defaultValue` (posted with a GET form) or `value` + `onValueChange(value: string)`. `""` is a real option value ("Anyone", "Blank role"). `size`: `default` (40px) or `small` (32px). |
| `choice-list.tsx` `MenuChoiceList` | shadcn `Select` popup | `options`, `value`, `onValueChange(value: string)`, `aria-label`, `id`. Works inside a kit `Popover`. Exposes `combobox` and `option` roles. |
| `date-field.tsx` `DateField` | native `<input type="date">` | `id`, `name`, `defaultValue` as `YYYY-MM-DD` or `""`. Posted with a GET form. |
| `day-picker.tsx` `DayPicker` | shadcn `Calendar`, inline | `kind`: `date` or `week`; `anchor` `YYYY-MM-DD`; `onPick(day: string)` with the clicked day as `YYYY-MM-DD`. Monday first; in week mode the anchor's Monday-to-Sunday week shows as one band. The caller turns a day into a week's Monday. |
| `tick-box.tsx` `TickBox` | shadcn `Checkbox` | `id`, `checked`, `disabled`, `onCheckedChange(checked: boolean)`, `aria-describedby`. Named by a `<label htmlFor>`. |
| `filter-button.tsx` `FilterButton` | shadcn ghost icon button with the funnel | `label` (its name, such as "Filter Visited applicants") and `on` while the panel is filtered. It is a kit `Popover` trigger, so it passes on every other prop and the ref. Becomes `RoundButton` with the set 2 `filter` icon and its `on` state. |
| `disclosure.tsx` `Disclosure` | shadcn `Collapsible` | `label`, `children`; collapsed at first; the trigger is a button with `aria-expanded`. |
