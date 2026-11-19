"use client"

import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { FieldInput, type FieldInputProps } from "./controls"
import { formatAgentCode, formatCode, typeInNameBox } from "./typing"
import "./guided-form.css"

// The name boxes and the code box (prototype v38). They live with the guided
// form, not in components/kit, so the public forms can use them without
// loading the staff kit's stylesheet. Field names follow the names contract
// on #400: firstName, middleName, lastName for a person; fatherFirst,
// fatherMiddle, fatherLast for a student's father.

export type PersonName = { firstName: string; middleName: string; lastName: string }
export type FatherName = { fatherFirst: string; fatherMiddle: string; fatherLast: string }
export type StudentName = { firstName: string } & FatherName

/** Each box's placeholder, which is also its name for a screen reader. There is no label above the boxes. */
export type NameLabels = { first: string; middle: string; last: string }

const CAPS = "uppercase tracking-[0.03em] placeholder:normal-case placeholder:tracking-normal"

type Common<V> = {
  /** The base of each box's id: `${id}-firstName` and so on. */
  id?: string
  value?: V
  defaultValue?: Partial<V>
  onChange?: (value: V) => void
  /** What each box posts as, when it is not the field's own name, such as `students[0][firstName]`. */
  names?: Partial<Record<keyof V, string>>
  /** The boxes that are wrong: a red line on each. Say why in one error line linked by `aria-describedby`. */
  invalid?: Partial<Record<keyof V, boolean>>
  /** Every box is required unless this is false. */
  required?: boolean
  /** The longest each box takes, when there is a limit. */
  maxLength?: number
  disabled?: boolean
  /** Shown and focusable, but not changed: a name the record keeps as it is. */
  readOnly?: boolean
  "aria-describedby"?: string
  /** Names the group, such as the open question's title. */
  "aria-labelledby"?: string
  className?: string
}

type Box<K> = { key: K; placeholder: string; wide?: boolean }

function useNameBoxes<K extends string>(keys: readonly K[], props: Common<Record<K, string>>) {
  const empty = Object.fromEntries(keys.map((k) => [k, ""])) as Record<K, string>
  const [own, setOwn] = useState<Record<K, string>>({ ...empty, ...props.defaultValue })
  const values = props.value ?? own
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const focusNext = useRef<number | null>(null)

  // After a space or a paste moves on, the caret goes to the end of the box it lands in.
  useLayoutEffect(() => {
    const i = focusNext.current
    if (i === null) return
    focusNext.current = null
    caretToEnd(refs.current[i])
  })

  const set = (next: Record<K, string>) => {
    if (props.value === undefined) setOwn(next)
    props.onChange?.(next)
  }

  const typed = (index: number, input: HTMLInputElement) => {
    const { values: next, focus } = typeInNameBox(keys, values, index, input.value)
    if (focus === null) {
      // Same box: put the capitals in place now and keep the caret, so React has nothing left to change.
      const shown = next[keys[index]]
      if (shown !== input.value) {
        const { selectionStart: a, selectionEnd: b } = input
        input.value = shown
        if (a !== null && b !== null) input.setSelectionRange(Math.min(a, shown.length), Math.min(b, shown.length))
      }
    } else focusNext.current = focus
    set(next)
  }

  const boxProps = (index: number) => ({
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      // A phone keyboard composes each word; change nothing until the word is done.
      if ((event.nativeEvent as InputEvent).isComposing) set({ ...values, [keys[index]]: event.currentTarget.value })
      else typed(index, event.currentTarget)
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => typed(index, event.currentTarget),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      // Enter or Backspace inside a word the keyboard is still composing belongs to the keyboard.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === "Backspace" && !event.currentTarget.value && index > 0) {
        event.preventDefault()
        caretToEnd(refs.current[index - 1])
      } else if (event.key === "Enter" && index < keys.length - 1) {
        event.preventDefault()
        caretToEnd(refs.current[index + 1])
      }
    },
  })

  return { values, refs, boxProps }
}

function caretToEnd(input: HTMLInputElement | null | undefined) {
  if (!input) return
  input.focus({ preventScroll: true })
  const n = input.value.length
  input.setSelectionRange(n, n)
}

function NameBoxGroup<K extends string>({ boxes, heading, ...props }: Common<Record<K, string>> & { boxes: Box<K>[]; heading?: { before: number; label: ReactNode } }) {
  const keys = boxes.map((b) => b.key)
  const { values, refs, boxProps } = useNameBoxes(keys, props)
  const auto = useId()
  const base = props.id ?? auto
  const last = boxes.length - 1

  const box = (b: Box<K>, index: number) => (
    <div key={b.key} className="gf-name" data-wide={b.wide ? "" : undefined}>
      <FieldInput
        ref={(el) => {
          refs.current[index] = el
        }}
        id={`${base}-${b.key}`}
        name={props.names?.[b.key] ?? b.key}
        value={values[b.key]}
        placeholder={b.placeholder}
        aria-label={b.placeholder}
        aria-describedby={props["aria-describedby"]}
        invalid={props.invalid?.[b.key]}
        required={props.required ?? true}
        maxLength={props.maxLength}
        disabled={props.disabled}
        readOnly={props.readOnly}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint={index < last ? "next" : undefined}
        className={CAPS}
        {...boxProps(index)}
      />
    </div>
  )

  const split = heading?.before ?? boxes.length
  return (
    <div role="group" aria-labelledby={props["aria-labelledby"]} className={cn("gf-names", props.className)}>
      {boxes.slice(0, split).map((b, i) => box(b, i))}
      {heading && (
        <div role="group" aria-labelledby={`${base}-head`} className="gf-names-sub">
          <p id={`${base}-head`} className="gf-names-head">
            {heading.label}
          </p>
          {boxes.slice(split).map((b, i) => box(b, split + i))}
        </div>
      )}
    </div>
  )
}

/**
 * An agent, a custodian or any other person: First name across, Middle and
 * Last side by side. In capitals; Space moves to the next box, a pasted full
 * name spreads across the boxes, Backspace in an empty box goes back.
 */
export function PersonNameBoxes({ labels, ...props }: Common<PersonName> & { labels: NameLabels }) {
  return (
    <NameBoxGroup<keyof PersonName>
      {...props}
      boxes={[
        { key: "firstName", placeholder: labels.first, wide: true },
        { key: "middleName", placeholder: labels.middle },
        { key: "lastName", placeholder: labels.last },
      ]}
    />
  )
}

const fatherBoxes = (labels: NameLabels): Box<keyof FatherName>[] => [
  { key: "fatherFirst", placeholder: labels.first },
  { key: "fatherMiddle", placeholder: labels.middle },
  { key: "fatherLast", placeholder: labels.last, wide: true },
]

/** A student's father on his own, as when a record's father is corrected: First and Middle side by side, Last across. */
export function FatherNameBoxes({ labels, ...props }: Common<FatherName> & { labels: NameLabels }) {
  return <NameBoxGroup<keyof FatherName> {...props} boxes={fatherBoxes(labels)} />
}

/**
 * The student's name in one box across, then the "Father's name" group in the
 * father layout. Space and paste run on from the student's box into the
 * father's, as one set of boxes.
 */
export function StudentNameBoxes({ labels, ...props }: Common<StudentName> & { labels: NameLabels & { student: string; father: ReactNode } }) {
  return (
    <NameBoxGroup<keyof StudentName>
      {...props}
      boxes={[{ key: "firstName", placeholder: labels.student, wide: true }, ...fatherBoxes(labels)]}
      heading={{ before: 1, label: labels.father }}
    />
  )
}

type OneBoxProps = Omit<FieldInputProps, "value" | "defaultValue" | "onChange" | "icon"> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

/** Keeps a single box's value through `format`, with the caret where it was or, when the text moved, at the end. */
function useOneBox({ value, defaultValue, onValueChange }: OneBoxProps, format: (raw: string, previous: string) => string, caretToEndOnChange: boolean) {
  const [own, setOwn] = useState(defaultValue ?? "")
  const shown = value ?? own
  const typed = (input: HTMLInputElement) => {
    const next = format(input.value, shown)
    if (next !== input.value) {
      const { selectionStart: a, selectionEnd: b } = input
      input.value = next
      if (caretToEndOnChange) input.setSelectionRange(next.length, next.length)
      else if (a !== null && b !== null) input.setSelectionRange(Math.min(a, next.length), Math.min(b, next.length))
    }
    if (value === undefined) setOwn(next)
    onValueChange?.(next)
  }
  return {
    value: shown,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if ((event.nativeEvent as InputEvent).isComposing) {
        if (value === undefined) setOwn(event.currentTarget.value)
        onValueChange?.(event.currentTarget.value)
      } else typed(event.currentTarget)
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => typed(event.currentTarget),
  }
}

/**
 * One full-name box in capitals, for "Who brought the students" when it is
 * someone else. Spaces stay. Check `hasTwoNames` before saving and say
 * "at least two names" in the field's error line.
 */
export function FullNameBox({ className, ...props }: OneBoxProps) {
  const { value, defaultValue, onValueChange, ...rest } = props
  const box = useOneBox({ value, defaultValue, onValueChange }, (raw) => raw.toUpperCase(), false)
  return <FieldInput autoComplete="off" autoCapitalize="characters" spellCheck={false} {...rest} {...box} className={cn(CAPS, className)} />
}

/**
 * The Admission form's Discount code box, for an agent's code or a Promo
 * code: capitals, the hyphen added between three letters and a digit by
 * itself (AAN132 → AAN-132), anything else kept as typed (SAVE10, AS-135,
 * $AVE), at most 20 characters. See `formatCode`.
 */
export function CodeBox({ className, ...props }: OneBoxProps) {
  const { value, defaultValue, onValueChange, ...rest } = props
  const box = useOneBox({ value, defaultValue: defaultValue === undefined ? undefined : formatCode(defaultValue), onValueChange }, formatCode, true)
  return <FieldInput autoComplete="off" autoCapitalize="characters" spellCheck={false} {...rest} {...box} className={cn(CAPS, className)} />
}

/**
 * A box for an agent's Discount code only, ABC-123: three letters, the hyphen
 * by itself, then three digits; anything else is dropped and a hyphen typed
 * again is ignored. See `formatAgentCode`.
 */
export function AgentCodeBox({ className, ...props }: OneBoxProps) {
  const { value, defaultValue, onValueChange, ...rest } = props
  const box = useOneBox({ value, defaultValue: defaultValue === undefined ? undefined : formatAgentCode(defaultValue), onValueChange }, formatAgentCode, true)
  return <FieldInput autoComplete="off" autoCapitalize="characters" spellCheck={false} {...rest} {...box} className={cn(CAPS, className)} />
}
