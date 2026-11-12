# Form parts for Reports, Staff and roles and Audit

These screens reach the kit's form parts (#358) through one small file each, so each caller keeps the props it had while the parts were being built (#331). Each file draws the kit part from `@/components/kit` and passes the caller's props straight on. The kit README's "Form parts" section is the contract.

| File | Kit part | Used by |
|---|---|---|
| `choice-list.tsx` `ChoiceList` | `Select`, in a form (`name` + `defaultValue`) or controlled | Audit Who and Area; Roles "Start from" |
| `choice-list.tsx` `MenuChoiceList` | `Select`, controlled, inside a kit `Popover` | Reports Period, Month, Year and Enrollment year |
| `date-field.tsx` `DateField` | `DateField`, posting `YYYY-MM-DD` with a GET form | Audit From and To |
| `day-picker.tsx` `DayPicker` | `Calendar`, `mode` `day` or `week` | Reports Date and Week periods |
| `tick-box.tsx` `TickBox` | `Checkbox` without `label`, named by the caller's `<label htmlFor>` | Roles permissions and "Manages the staff in" |
| `disclosure.tsx` `Disclosure` | `Disclosure` `variant="plain"` | Roles History |
| `filter-button.tsx` `FilterButton` | `RoundButton` `icon="filter"`, `size={40}`, `on` | Reports filter buttons, as a kit `Popover` trigger |

Specs pick from a choice list with `chooseOption` and fill a date with `dayFirst`, both in `e2e/kit-parts.ts`.
