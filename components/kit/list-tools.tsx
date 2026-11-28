"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import { useRef, useState, type ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import { Button, RoundButton } from "./button"
import { MonthGrid } from "./calendar"
import "./kit.css"
import "./list-tools.css"
import { Pagination, type PaginationProps } from "./pagination"

// The tools of a long list (Interviews revamp, prototype 1MpUKuX27V6pc1CS1z1URz
// v5): a search box that narrows the list on every letter, the letters it
// matched, a day to show, a column heading that sorts and filters, a Filter
// button with groups, and the count with page numbers under the list.

/**
 * The compact field with the search icon and a round Clear button that shows
 * once something is typed. Escape clears it too. The list changes on every
 * letter, so there is no Search button.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel = "Clear the search",
  id,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** The field's name for a screen reader, saying what it searches. */
  label: string
  placeholder?: string
  clearLabel?: string
  id?: string
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div role="search" className={cn("kit-search", className)}>
      <Icon name="search" />
      <input
        ref={input}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") return
          event.preventDefault()
          event.stopPropagation()
          onChange("")
        }}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        data-size="compact"
        data-align="start"
        className="kit-field"
      />
      {value !== "" && (
        <button
          type="button"
          className="kit-search-x"
          aria-label={clearLabel}
          data-icon-host=""
          onClick={() => {
            onChange("")
            input.current?.focus()
          }}
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  )
}

/** Text with the stretches a search matched marked in light orange. `marks` are [start, end) offsets. */
export function Highlight({ text, marks }: { text: string; marks: readonly (readonly [number, number])[] }) {
  if (marks.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of [...marks].sort((a, b) => a[0] - b[0])) {
    if (start < at || end <= start) continue
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="kit-hit">
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

/**
 * A day to show, or any day: the Select's 44px pill with the calendar icon,
 * opening the kit's month calendar with Any date and Today at its foot. A
 * picked day turns the pill Lavender Whisper with the indigo line, like a
 * filter that is on.
 */
export function DateChoice({
  value,
  onChange,
  label,
  formatDay,
  today,
  anyLabel = "Any date",
  todayLabel = "Today",
  className,
}: {
  /** "YYYY-MM-DD", or "" for any day. */
  value: string
  onChange: (value: string) => void
  /** What the day is, such as "Registered on"; the button reads "Registered on: any date". */
  label: string
  /** How the picked day is written on the pill. */
  formatDay: (day: string) => string
  /** Today, "YYYY-MM-DD", for the Today button. */
  today: string
  anyLabel?: string
  todayLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const pick = (day: string) => {
    onChange(day)
    setOpen(false)
  }
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <BasePopover.Trigger
        render={
          <button
            type="button"
            className={cn("kit-field kit-datec", className)}
            data-on={value ? "" : undefined}
            data-icon-host=""
            aria-label={`${label}: ${value ? formatDay(value) : anyLabel.toLowerCase()}`}
          >
            <Icon name="calendar" size={17} className="kit-datec-ic" />
            <span className="kit-datec-v" data-empty={value ? undefined : ""}>
              {value ? formatDay(value) : anyLabel}
            </span>
            <Icon name="down" size={16} className="kit-sel-chev" />
          </button>
        }
      />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
          <BasePopover.Popup aria-label={label} className="kit-pop kit-datec-pop">
            <DatePanel value={value} onPick={pick} today={today} anyLabel={anyLabel} todayLabel={todayLabel} />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** The month calendar with Any date and Today under it: the body of a DateChoice, or of a date column's filter. */
export function DatePanel({
  value,
  onPick,
  today,
  anyLabel = "Any date",
  todayLabel = "Today",
}: {
  value: string
  /** The picked day, or "" for Any date. */
  onPick: (day: string) => void
  today: string
  anyLabel?: string
  todayLabel?: string
}) {
  return (
    <>
      <MonthGrid value={value} onPick={onPick} autoFocus />
      <div className="kit-pop-foot">
        <button type="button" className="kit-link" onClick={() => onPick("")}>
          {anyLabel}
        </button>
        <Button variant="ghost" size="small" onClick={() => onPick(today)}>
          {todayLabel}
        </Button>
      </div>
    </>
  )
}

export type FilterChoice = { value: string; label: string; count?: number }

type ChoicesBase = {
  /** Names the group for a screen reader, such as "Class". */
  label: string
  options: readonly FilterChoice[]
  /** The first row or chip, which clears the group, such as "All" or "All classes". */
  allLabel?: string
  /** Rows (with counts) or wrapping chips. */
  look?: "rows" | "chips"
}

/**
 * One filter's choices, as rows with their counts or as chips. A one-choice
 * group (`many` left out) keeps one value, "" for all; a `many` group keeps
 * any number, [] for all, each row with a tick box or each chip pressed.
 */
export function FilterChoices(
  props: ChoicesBase &
    ({ many?: false; value: string; onChange: (value: string) => void } | { many: true; value: readonly string[]; onChange: (value: string[]) => void }),
) {
  const { label, options, allLabel = "All", look = "rows" } = props
  const chosen = (value: string) => (props.many ? props.value.includes(value) : props.value === value)
  const none = props.many ? props.value.length === 0 : props.value === ""
  const choose = (value: string) => {
    if (!props.many) return props.onChange(value)
    if (value === "") return props.onChange([])
    props.onChange(props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value])
  }
  const all: FilterChoice = { value: "", label: allLabel }
  const items = [all, ...options]

  if (look === "chips") {
    return (
      <div role="group" aria-label={label} className="kit-fchips">
        {items.map((option) => (
          <button key={option.value} type="button" className="kit-chipb" aria-pressed={option.value === "" ? none : chosen(option.value)} onClick={() => choose(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div role="group" aria-label={label} className="kit-fchoices">
      {items.map((option) => {
        const on = option.value === "" ? none : chosen(option.value)
        const box = props.many && option.value !== ""
        return (
          <button key={option.value} type="button" className="kit-filter-opt" data-box={box ? "" : undefined} aria-pressed={on} onClick={() => choose(option.value)}>
            {box && (
              <i className="kit-fbox" aria-hidden="true">
                <Icon name="check" size={16} />
              </i>
            )}
            <span>{option.label}</span>
            <small>{option.count ?? ""}</small>
            {box ? <i aria-hidden="true" /> : on ? <Icon name="check" size={18} /> : <i aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

export type FilterGroup = ChoicesBase & { key: string } & (
    | { many?: false; value: string; onChange: (value: string) => void }
    | { many: true; value: readonly string[]; onChange: (value: string[]) => void }
  )

/**
 * The 40px Filter button with the orange dot while any filter is on, opening
 * the filter's groups, each under its name, with Clear filters and Done at
 * the foot. A choice applies at once; the menu stays open for the next one.
 */
export function FilterGroupsMenu({
  label = "Filter",
  groups,
  onClear,
  clearLabel = "Clear filters",
  doneLabel = "Done",
  className,
}: {
  label?: string
  groups: readonly FilterGroup[]
  onClear: () => void
  clearLabel?: string
  doneLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const on = groups.filter((group) => (group.many ? group.value.length > 0 : group.value !== ""))
  return (
    <span className={cn("kit-filter-wrap", className)}>
      <BasePopover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
        <BasePopover.Trigger
          render={<RoundButton icon="filter" size={40} on={on.length > 0} label={on.length ? `${label}: ${on.map((g) => g.label).join(", ")} on` : label} />}
        />
        {on.length > 0 && <i className="kit-filter-pip" aria-hidden="true" />}
        <BasePopover.Portal>
          <BasePopover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
            <BasePopover.Popup aria-label={label} className="kit-pop kit-fgroups">
              <div className="kit-fgroups-body">
                {groups.map(({ key, ...group }) => (
                  <section key={key} className="kit-fgroup">
                    <p className="kit-fgroup-h" aria-hidden="true">
                      {group.label}
                    </p>
                    <FilterChoices {...group} />
                  </section>
                ))}
              </div>
              <div className="kit-pop-foot">
                <button type="button" className="kit-link" onClick={onClear}>
                  {clearLabel}
                </button>
                <Button variant="ghost" size="small" onClick={() => setOpen(false)}>
                  {doneLabel}
                </Button>
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </span>
  )
}

export type SortDirection = "asc" | "desc"

const SORT_WORDS = { lowest: "lowest first", highest: "highest first", usual: "back to the usual order" }

/**
 * A column heading for a Table. With `onSort`, two small chevrons follow the
 * name: both faint until pressed, then the one in use bright. With `filter`,
 * the name (dotted underline) opens that column's filter, and an orange dot
 * follows it while the filter is on. Give the column `ariaSort` too.
 */
export function ColumnHeader({
  label,
  sort,
  onSort,
  filter,
  filterOn = false,
  filterWide = false,
  sortWords = SORT_WORDS,
}: {
  label: string
  /** The column's sort now: null when another column, or none, sorts the list. */
  sort?: SortDirection | null
  onSort?: () => void
  /** The filter's content; `close` shuts the popover after a one-choice pick. */
  filter?: (close: () => void) => ReactNode
  filterOn?: boolean
  /** A wider filter, for a calendar. */
  filterWide?: boolean
  sortWords?: typeof SORT_WORDS
}) {
  const [open, setOpen] = useState(false)
  const next = !sort ? sortWords.lowest : sort === "asc" ? sortWords.highest : sortWords.usual
  return (
    <span className="kit-th">
      {filter ? (
        <BasePopover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
          <BasePopover.Trigger
            render={
              <button type="button" className="kit-th-name" data-on={filterOn ? "" : undefined} aria-label={`Filter by ${label}${filterOn ? ", on" : ""}`}>
                {label}
                {filterOn && <i className="kit-th-dot" aria-hidden="true" />}
              </button>
            }
          />
          <BasePopover.Portal>
            <BasePopover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
              <BasePopover.Popup aria-label={`Filter by ${label}`} className="kit-pop kit-colpop" data-wide={filterWide ? "" : undefined}>
                {filter(() => setOpen(false))}
              </BasePopover.Popup>
            </BasePopover.Positioner>
          </BasePopover.Portal>
        </BasePopover.Root>
      ) : (
        <span>{label}</span>
      )}
      {onSort && (
        <button type="button" className="kit-th-sort" data-icon-host="" aria-label={`Sort by ${label}, ${next}`} onClick={onSort}>
          <i className="kit-th-c" data-up="" data-off={sort === "asc" ? undefined : ""}>
            <Icon name="down" size={16} />
          </i>
          <i className="kit-th-c" data-off={sort === "desc" ? undefined : ""}>
            <Icon name="down" size={16} />
          </i>
        </button>
      )}
    </span>
  )
}

/** Under a long list: how many it shows, then the kit's page numbers. */
export function ListFoot({ summary, pagination }: { summary: ReactNode; pagination?: PaginationProps }) {
  return (
    <div className="kit-lfoot">
      <p className="kit-lfoot-t">{summary}</p>
      {pagination && <Pagination {...pagination} />}
    </div>
  )
}
