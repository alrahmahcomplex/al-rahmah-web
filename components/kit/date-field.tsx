"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import { useEffect, useId, useRef, useState, type FocusEvent, type Ref, type RefObject } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import { DATE_WORDS, MonthGrid, type DateWords } from "./calendar"
import { joinDateTime, parseDayFirst, parseTime, showDayFirst, splitDateTime, todayIso, unreadableValue, withinBounds } from "./dates"
import { FieldError } from "./field"
import "./kit.css"

const joinIds = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined

/** What `onChange` says besides the value: true while the field holds text it cannot read, when the value is "" but the field is not empty. */
export type DateChange = { unreadable: boolean }

/** Runs `run` when the input's form is reset, as native inputs go back to their first value. */
function useFormReset(input: RefObject<HTMLInputElement | null>, run: () => void) {
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  useEffect(() => {
    const form = input.current?.form
    if (!form) return
    const reset = () => latest.current()
    form.addEventListener("reset", reset)
    return () => form.removeEventListener("reset", reset)
  }, [input])
}

/** Marks a date or time input that holds text it cannot read; the guards find the first one by it. */
const UNREADABLE = "data-kit-unreadable"

/**
 * Brings the first unreadable field in `form` into view: a fold-open section
 * around it opens (it listens for "kit:reveal"), then the field takes focus.
 */
function revealFirst(form: HTMLFormElement | null, fallback: HTMLElement) {
  const first = form?.querySelector<HTMLElement>(`[${UNREADABLE}]:not(:disabled)`) ?? fallback
  first.dispatchEvent(new Event("kit:reveal", { bubbles: true }))
  first.focus()
  // Inside a section that has only just opened, the field can take focus a frame later.
  if (document.activeElement !== first) requestAnimationFrame(() => first.focus())
}

/**
 * Keeps `input` invalid with `message` while it holds text that cannot be
 * read, so its form cannot submit. The browser's bubble never shows: the
 * part's own `invalid` handler cancels it, shows the part's line and moves
 * focus to the first field that is wrong. A form that skips validation
 * (`noValidate`) is stopped too: the part's own submit listener on the form
 * runs before React's `onSubmit` and a form action, cancels the submit and
 * keeps it from reaching them.
 */
function useUnreadableGuard(input: RefObject<HTMLInputElement | null>, message: string | null, show: () => void) {
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.setCustomValidity(message ?? "")
    if (message) el.setAttribute(UNREADABLE, "")
    else el.removeAttribute(UNREADABLE)
  }, [input, message])
  const latest = useRef(show)
  useEffect(() => {
    latest.current = show
  })
  useEffect(() => {
    const el = input.current
    if (!el) return
    const form = el.form
    const onInvalid = (event: Event) => {
      event.preventDefault()
      latest.current()
      const first = form?.querySelector<HTMLElement>(":invalid:not(form):not(fieldset)")
      if (!first || first === el) revealFirst(form, el)
    }
    const onSubmit = (event: Event) => {
      // A disabled field is not sent, so it never holds its form back (a disabled fieldset included).
      if (!el.hasAttribute(UNREADABLE) || el.matches(":disabled")) return
      event.preventDefault()
      event.stopImmediatePropagation()
      latest.current()
      revealFirst(form, el)
    }
    el.addEventListener("invalid", onInvalid)
    form?.addEventListener("submit", onSubmit)
    return () => {
      el.removeEventListener("invalid", onInvalid)
      form?.removeEventListener("submit", onSubmit)
    }
  }, [input])
}

function setRefs<T>(el: T, ...refs: (Ref<T> | undefined)[]) {
  for (const ref of refs) {
    if (typeof ref === "function") ref(el)
    else if (ref) (ref as { current: T }).current = el
  }
}

export type DateFieldProps = {
  /** On the typed input, so a `<label htmlFor>` names it. */
  id?: string
  /** Controlled: "YYYY-MM-DD", or "" when empty. */
  value?: string
  /**
   * "YYYY-MM-DD" while the typed text is a real date (bounds or not), and ""
   * otherwise. `unreadable` is true while the field holds text that is not a
   * date: never save while it is. In a `<form>` the part blocks the submit itself.
   */
  onChange?: (value: string, change: DateChange) => void
  /** Uncontrolled inside a form: the posted field's name and first value ("YYYY-MM-DD" or ""). */
  name?: string
  defaultValue?: string
  /** "YYYY-MM-DD" bounds: the calendar greys out the days outside them. A typed date outside them is still submitted as typed. */
  min?: string
  max?: string
  /** Announced as required. An empty field is left to the screen's own check, so no browser bubble shows. */
  required?: boolean
  disabled?: boolean
  /** Draws the red outline and sets aria-invalid, for the server's refusal. */
  invalid?: boolean
  "aria-invalid"?: boolean | "true" | "false"
  "aria-describedby"?: string
  "aria-label"?: string
  words?: Partial<DateWords>
  className?: string
  ref?: Ref<HTMLInputElement>
}

type DateBoxProps = Omit<DateFieldProps, "name" | "defaultValue" | "value" | "onChange" | "className" | "words" | "invalid"> & {
  text: string
  onText: (text: string) => void
  /** Draws the field wrong: its message shows, or the caller says so. */
  invalid: boolean
  inputRef: RefObject<HTMLInputElement | null>
  words: DateWords
}

/** The typed pill and its calendar button and popup, without the hidden input or the message. */
function DateBox({ id, text, onText, min, max, required, disabled, invalid, words, inputRef, ref, ...aria }: DateBoxProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const typed = parseDayFirst(text) ?? ""
  const today = todayIso()

  const pick = (day: string) => {
    onText(showDayFirst(day))
    setOpen(false)
  }

  return (
    <BasePopover.Root open={open} onOpenChange={(next) => setOpen(next)} modal={false}>
      <div ref={anchor} className="kit-date">
        <input
          ref={(el) => setRefs(el, inputRef, ref)}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={text}
          disabled={disabled}
          aria-required={required || undefined}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={invalid || aria["aria-invalid"] === true || aria["aria-invalid"] === "true" || undefined}
          className="kit-field kit-date-in"
          data-size="compact"
          data-align="start"
          onChange={(event) => onText(event.target.value)}
          onBlur={() => {
            const day = parseDayFirst(text)
            if (day) onText(showDayFirst(day))
          }}
        />
        <BasePopover.Trigger disabled={disabled} aria-label={words.openCalendar} className="kit-date-btn">
          <Icon name="calendar" size={18} />
        </BasePopover.Trigger>
      </div>
      <BasePopover.Portal>
        <BasePopover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={6} collisionPadding={12} className="kit-up-pos">
          <BasePopover.Popup
            ref={popup}
            aria-label={words.chooseDate}
            initialFocus={() => popup.current?.querySelector<HTMLElement>(".kit-cal-day[tabindex='0']") ?? true}
            className="kit-up kit-cal-pop"
          >
            <MonthGrid value={typed} onPick={pick} min={min} max={max} words={words} />
            {withinBounds(today, min, max) && (
              <div className="kit-cal-foot">
                <button type="button" className="kit-link" onClick={() => pick(today)}>
                  {words.today}
                </button>
              </div>
            )}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** The typed date, kept in step with a controlled value without wiping what is half typed. */
function useDayText(value: string | undefined, defaultValue: string, emit: (day: string, unreadable: boolean) => void) {
  const controlled = value !== undefined
  const [text, setText] = useState(() => showDayFirst(controlled ? value : defaultValue))
  const day = parseDayFirst(text) ?? ""
  const unreadable = text.trim() !== "" && !day

  // A new value from outside (a reset, a picked default) replaces the text; the value the text already means does not.
  const [seen, setSeen] = useState(value)
  if (controlled && value !== seen) {
    setSeen(value)
    if (value !== day && !(value === "" && unreadable)) setText(showDayFirst(value))
  }

  const onText = (next: string) => {
    setText(next)
    const nextDay = parseDayFirst(next) ?? ""
    const nextUnreadable = next.trim() !== "" && !nextDay
    if (nextDay !== day || nextUnreadable !== unreadable) emit(nextDay, nextUnreadable)
  }
  /** Shows `to` ("YYYY-MM-DD" or ""), as a reset or a new value from outside does. */
  const replace = (to: string) => setText(showDayFirst(to))
  return { text, day, unreadable, onText, replace }
}

/** Leaving a part of the field (focus moving outside it, not into its own calendar). */
const leaves = (event: FocusEvent<HTMLElement>) => !event.currentTarget.contains(event.relatedTarget as Node | null)

/**
 * The date field (prototype version 18): a typed day-first pill (DD/MM/YYYY)
 * with a calendar button that opens our own calendar, never the browser's.
 * "5/9/2026" and a pasted "2026-09-05" tidy to "05/09/2026". Text that is not
 * a real date shows "Type the date as day/month/year…" once the person
 * leaves the field, and keeps its form from submitting. It submits
 * "YYYY-MM-DD", as a native date input does, so no action changes.
 */
export function DateField({ value, onChange, name, defaultValue = "", words: wordsProp, invalid, className, ...props }: DateFieldProps) {
  const words = { ...DATE_WORDS, ...wordsProp }
  const date = useDayText(value, defaultValue, (day, unreadable) => onChange?.(day, { unreadable }))
  const [shown, setShown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const wrong = shown && date.unreadable

  useUnreadableGuard(inputRef, date.unreadable ? words.wrongDate : null, () => setShown(true))
  // A reset shows the first value; a controlled field shows its parent's value, so what posts is what the parent holds.
  useFormReset(inputRef, () => {
    date.replace(value !== undefined ? value : defaultValue)
    setShown(false)
  })

  return (
    <div className={cn("kit-datef", className)} onBlur={(event) => leaves(event) && setShown(true)}>
      <DateBox
        {...props}
        text={date.text}
        onText={(next) => {
          // Typing clears the line; it comes back when the person leaves the field.
          setShown(false)
          date.onText(next)
        }}
        invalid={wrong || !!invalid}
        inputRef={inputRef}
        words={words}
        aria-describedby={joinIds(props["aria-describedby"], wrong && errorId)}
      />
      {name && <input type="hidden" name={name} value={date.unreadable ? unreadableValue(date.text) : date.day} disabled={props.disabled} />}
      {wrong && <FieldError id={errorId} message={words.wrongDate} alignStart />}
    </div>
  )
}

export type DateTimeFieldProps = Omit<DateFieldProps, "aria-label"> & {
  /** Names the date and time together, as a group. Pass the label's id. */
  "aria-labelledby"?: string
}

/**
 * A day and a time under one label (prototype version 18): the date field,
 * then a 104px typed 24-hour time (HH:MM). "930" tidies to "09:30". It
 * submits the `datetime-local` format, "YYYY-MM-DDTHH:MM"; both halves empty
 * submit "". A half that is wrong, or missing while the other is filled,
 * shows its own sentence and keeps the form from submitting. `id` goes on the
 * date, so a `<label htmlFor>` names the first input; `max` and `min` may be
 * datetime-local values or days.
 */
export function DateTimeField({ id, value, onChange, name, defaultValue = "", min, max, words: wordsProp, invalid, className, ...props }: DateTimeFieldProps) {
  const words = { ...DATE_WORDS, ...wordsProp }
  const controlled = value !== undefined
  const first = splitDateTime(controlled ? value : defaultValue)
  const [time, setTime] = useState(first.time)
  const tidyTime = parseTime(time) ?? ""
  const hasTime = time.trim() !== ""

  const emit = (dateText: string, day: string, timeText: string, tidy: string) => {
    const dateBad = (dateText.trim() !== "" && !day) || (dateText.trim() === "" && timeText.trim() !== "")
    const timeBad = (timeText.trim() !== "" && !tidy) || (timeText.trim() === "" && dateText.trim() !== "")
    onChange?.(joinDateTime(day, tidy), { unreadable: dateBad || timeBad })
  }

  // Both halves are kept here, so the parent echoing "" for a half-typed value never wipes the other half.
  const date = useDayText(undefined, first.date, () => {})
  const hasDate = date.text.trim() !== ""
  const dateBad = date.unreadable || (!hasDate && hasTime)
  const timeBad = (hasTime && !tidyTime) || (!hasTime && hasDate)
  const joined = joinDateTime(date.day, tidyTime)

  // A new controlled value replaces each half the typed text does not already mean. The "" the
  // parent sends back while a half cannot be read is our own echo, and changes neither half.
  const [seen, setSeen] = useState(value)
  if (controlled && value !== seen) {
    setSeen(value)
    if (!(value === "" && (dateBad || timeBad))) {
      const next = splitDateTime(value)
      if (next.date !== date.day) date.replace(next.date)
      if (next.time !== tidyTime) setTime(next.time)
    }
  }

  const [dateShown, setDateShown] = useState(false)
  const [timeShown, setTimeShown] = useState(false)
  const dateWrong = dateShown && dateBad
  const timeWrong = timeShown && timeBad

  const dateRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const dateError = useId()
  const timeError = useId()
  useUnreadableGuard(dateRef, dateBad ? words.wrongDate : null, () => setDateShown(true))
  useUnreadableGuard(timeRef, timeBad ? words.wrongTime : null, () => setTimeShown(true))
  // The date is "Date" unless a caller's own <label htmlFor={id}> names it ("When"); read once it is in the page.
  const dateName = words.date
  useEffect(() => {
    const el = dateRef.current
    if (!el) return
    if (el.labels?.length) el.removeAttribute("aria-label")
    else el.setAttribute("aria-label", dateName)
  }, [dateName, id])
  useFormReset(dateRef, () => {
    const to = splitDateTime(controlled ? value : defaultValue)
    date.replace(to.date)
    setTime(to.time)
    setDateShown(false)
    setTimeShown(false)
  })

  return (
    <div className={cn("kit-datef", className)}>
      <div role="group" aria-labelledby={props["aria-labelledby"]} className="kit-dt">
        <div onBlur={(event) => leaves(event) && setDateShown(true)}>
          <DateBox
            {...props}
            id={id}
            min={min?.slice(0, 10)}
            max={max?.slice(0, 10)}
            text={date.text}
            onText={(next) => {
              setDateShown(false)
              date.onText(next)
              emit(next, parseDayFirst(next) ?? "", time, tidyTime)
            }}
            invalid={dateWrong || !!invalid}
            inputRef={dateRef}
            words={words}
            aria-describedby={joinIds(props["aria-describedby"], dateWrong && dateError)}
          />
        </div>
        <input
          ref={timeRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM"
          maxLength={5}
          value={time}
          disabled={props.disabled}
          aria-required={props.required || undefined}
          aria-label={words.time}
          aria-describedby={joinIds(props["aria-describedby"], timeWrong && timeError)}
          aria-invalid={timeWrong || invalid || undefined}
          className="kit-field kit-time"
          data-size="compact"
          onChange={(event) => {
            const next = event.target.value
            setTime(next)
            setTimeShown(false)
            emit(date.text, date.day, next, parseTime(next) ?? "")
          }}
          onBlur={() => {
            const tidy = parseTime(time)
            if (tidy) setTime(tidy)
            setTimeShown(true)
          }}
        />
      </div>
      {name && <input type="hidden" name={name} value={dateBad || timeBad ? unreadableValue(`${date.text}T${time}`) : joined} disabled={props.disabled} />}
      {dateWrong && <FieldError id={dateError} message={words.wrongDate} alignStart />}
      {timeWrong && <FieldError id={timeError} message={words.wrongTime} alignStart />}
    </div>
  )
}
