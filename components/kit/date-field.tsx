"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import { useEffect, useId, useRef, useState, type ChangeEvent, type Ref, type RefObject } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import { DATE_WORDS, MonthGrid, type DateWords } from "./calendar"
import { joinDateTime, parseDayFirst, parseTime, showDayFirst, splitDateTime, todayIso, withinBounds } from "./dates"
import { FieldError } from "./field"
import "./kit.css"

const joinIds = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined

/** Puts a form's first value back when the form is reset, as native inputs do. */
function useFormReset(input: RefObject<HTMLInputElement | null>, reset: () => void) {
  const latest = useRef(reset)
  useEffect(() => {
    latest.current = reset
  })
  useEffect(() => {
    const form = input.current?.form
    if (!form) return
    const run = () => latest.current()
    form.addEventListener("reset", run)
    return () => form.removeEventListener("reset", run)
  }, [input])
}

export type DateFieldProps = {
  /** On the typed input, so a `<label htmlFor>` names it. */
  id?: string
  /** Controlled: "YYYY-MM-DD", or "" when empty. */
  value?: string
  /** "YYYY-MM-DD" while the typed text is a real date (bounds or not), "" while it is empty or not a date yet. */
  onChange?: (value: string) => void
  /** Uncontrolled inside a form: the posted field's name and first value ("YYYY-MM-DD" or ""). */
  name?: string
  defaultValue?: string
  /** "YYYY-MM-DD" bounds: the calendar greys out the days outside them. A typed date outside them is still submitted as typed. */
  min?: string
  max?: string
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

type DateBoxProps = Omit<DateFieldProps, "name" | "defaultValue" | "value" | "onChange" | "className"> & {
  text: string
  onText: (text: string) => void
  /** The typed text was left as something that is not a date. */
  wrong: boolean
  inputRef: RefObject<HTMLInputElement | null>
  words: DateWords
}

/** The typed pill and its calendar button and popup, without the hidden input or the message. */
function DateBox({ id, text, onText, wrong, min, max, required, disabled, invalid, words, inputRef, ref, ...aria }: DateBoxProps) {
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
          ref={(el) => {
            inputRef.current = el
            if (typeof ref === "function") ref(el)
            else if (ref) ref.current = el
          }}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={text}
          required={required}
          disabled={disabled}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={wrong || invalid || aria["aria-invalid"] === true || aria["aria-invalid"] === "true" || undefined}
          className="kit-field kit-date-in"
          data-size="compact"
          data-align="start"
          onChange={(event: ChangeEvent<HTMLInputElement>) => onText(event.target.value)}
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

/** The typed text, kept in step with a controlled value without wiping what is half typed. */
function useDayText(value: string | undefined, defaultValue: string, onChange?: (value: string) => void) {
  const controlled = value !== undefined
  const [text, setText] = useState(() => showDayFirst(controlled ? value : defaultValue))
  const [wrong, setWrong] = useState(false)
  const day = parseDayFirst(text) ?? ""

  // A new value from outside (a reset, a picked default) replaces the text; the value the text already means does not.
  const [seen, setSeen] = useState(value)
  if (controlled && value !== seen) {
    setSeen(value)
    if (value !== day) {
      setText(showDayFirst(value))
      setWrong(false)
    }
  }

  const onText = (next: string) => {
    setText(next)
    const nextDay = parseDayFirst(next) ?? ""
    // Shown once the person leaves the field (blur) or tidies it; typing clears it.
    setWrong(false)
    if (nextDay !== day) onChange?.(nextDay)
  }
  const reset = () => {
    setText(showDayFirst(defaultValue))
    setWrong(false)
  }
  return { text, day, wrong, setWrong, onText, reset }
}

/**
 * The date field (prototype version 18): a typed day-first pill (DD/MM/YYYY)
 * with a calendar button that opens our own calendar, never the browser's.
 * "5/9/2026" tidies to "05/09/2026"; text that is not a real date shows
 * "Type the date as day/month/year…" once the person leaves the field. It
 * submits "YYYY-MM-DD", as a native date input does, so no action changes.
 */
export function DateField({ value, onChange, name, defaultValue = "", words: wordsProp, className, ...props }: DateFieldProps) {
  const words = { ...DATE_WORDS, ...wordsProp }
  const { text, day, wrong, setWrong, onText, reset } = useDayText(value, defaultValue, onChange)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  useFormReset(inputRef, reset)

  return (
    <div
      className={cn("kit-datef", className)}
      onBlur={(event) => {
        // Checked when focus leaves the field and its calendar, not when it moves into the calendar.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setWrong(text.trim() !== "" && !parseDayFirst(text))
      }}
    >
      <DateBox
        {...props}
        text={text}
        onText={onText}
        wrong={wrong}
        inputRef={inputRef}
        words={words}
        aria-describedby={joinIds(props["aria-describedby"], wrong && errorId)}
      />
      {name && <input type="hidden" name={name} value={day} disabled={props.disabled} />}
      <FieldError id={errorId} message={wrong ? words.wrongDate : undefined} alignStart />
    </div>
  )
}

export type DateTimeFieldProps = Omit<DateFieldProps, "aria-label"> & {
  /** Names the date and time together, as a group. Pass the label's id. */
  "aria-labelledby"?: string
}

/**
 * A day and a time under one label (prototype version 18): the date field,
 * then a 104px typed 24-hour time (HH:MM). "930" tidies to "09:30"; a time
 * that is not one shows "Type the time as hours:minutes…". It submits the
 * `datetime-local` format, "YYYY-MM-DDTHH:MM", once both parts are complete.
 * `id` goes on the date, so a `<label htmlFor>` names the first input;
 * `max` and `min` may be datetime-local values or days.
 */
export function DateTimeField({ id, value, onChange, name, defaultValue = "", min, max, words: wordsProp, className, ...props }: DateTimeFieldProps) {
  const words = { ...DATE_WORDS, ...wordsProp }
  const controlled = value !== undefined
  const first = splitDateTime(controlled ? value : defaultValue)
  const [time, setTime] = useState(first.time)
  const [timeWrong, setTimeWrong] = useState(false)
  const tidyTime = parseTime(time) ?? ""
  const dateValue = controlled ? splitDateTime(value).date : undefined
  const date = useDayText(dateValue, first.date, (day) => onChange?.(joinDateTime(day, tidyTime)))
  const joined = joinDateTime(date.day, tidyTime)

  // A new controlled value replaces the time too, unless the typed time already means it.
  const [seen, setSeen] = useState(value)
  if (controlled && value !== seen) {
    setSeen(value)
    const next = splitDateTime(value).time
    if (next !== tidyTime) {
      setTime(next)
      setTimeWrong(false)
    }
  }

  const inputRef = useRef<HTMLInputElement>(null)
  const dateError = useId()
  const timeError = useId()
  useFormReset(inputRef, () => {
    date.reset()
    setTime(splitDateTime(defaultValue).time)
    setTimeWrong(false)
  })

  return (
    <div className={cn("kit-datef", className)}>
      <div role="group" aria-labelledby={props["aria-labelledby"]} className="kit-dt">
        <div
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            date.setWrong(date.text.trim() !== "" && !parseDayFirst(date.text))
          }}
        >
          <DateBox
            {...props}
            id={id}
            min={min?.slice(0, 10)}
            max={max?.slice(0, 10)}
            text={date.text}
            onText={date.onText}
            wrong={date.wrong}
            inputRef={inputRef}
            words={words}
            aria-label={words.date}
            aria-describedby={joinIds(props["aria-describedby"], date.wrong && dateError)}
          />
        </div>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM"
          maxLength={5}
          value={time}
          required={props.required}
          disabled={props.disabled}
          aria-label={words.time}
          aria-describedby={joinIds(props["aria-describedby"], timeWrong && timeError)}
          aria-invalid={timeWrong || props.invalid || undefined}
          className="kit-field kit-time"
          data-size="compact"
          onChange={(event) => {
            const next = event.target.value
            setTime(next)
            setTimeWrong(false)
            const nextTime = parseTime(next) ?? ""
            if (nextTime !== tidyTime) onChange?.(joinDateTime(date.day, nextTime))
          }}
          onBlur={() => {
            const tidy = parseTime(time)
            if (tidy) setTime(tidy)
            setTimeWrong(time.trim() !== "" && !tidy)
          }}
        />
      </div>
      {name && <input type="hidden" name={name} value={joined} disabled={props.disabled} />}
      <FieldError id={dateError} message={date.wrong ? words.wrongDate : undefined} alignStart />
      <FieldError id={timeError} message={timeWrong ? words.wrongTime : undefined} alignStart />
    </div>
  )
}
