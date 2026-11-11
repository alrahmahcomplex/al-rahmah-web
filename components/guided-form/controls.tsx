"use client"

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from "react"

import { cn } from "@/lib/utils"

import { Icon, type IconName } from "./icons"
import "./guided-form.css"

/**
 * The two-word "Badilisha …" link on a folded row (`.btn-text`): indigo,
 * underlined, 44px tall, never wraps above 380px.
 */
export function ChangeLink({ className, children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-semibold whitespace-nowrap text-blue-600 underline decoration-blue-600/35 underline-offset-4 transition-colors outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.97] max-[380px]:whitespace-normal",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * The open question (`h2.q`): centred Exo extra-bold italic, 26px. It takes
 * focus (tabIndex -1) so a new question can be announced. Pass `htmlFor` to
 * make the title the field's label.
 */
export function QuestionTitle({ id, htmlFor, children, ref, className }: { id?: string; htmlFor?: string; children: ReactNode; ref?: Ref<HTMLHeadingElement>; className?: string }) {
  return (
    <h2
      ref={ref}
      id={id}
      tabIndex={-1}
      className={cn(
        "m-0 w-full text-center font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic [overflow-wrap:anywhere] hyphens-auto outline-none",
        className,
      )}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className="cursor-pointer">
          {children}
        </label>
      ) : (
        children
      )}
    </h2>
  )
}

/** Small grey help line under a question (`.hint`). */
export function Hint({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("m-0 text-sm text-slate-500", className)}>
      {children}
    </p>
  )
}

export type FieldInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>
  invalid?: boolean
  /** A line icon inside the pill on the left, e.g. "phone". */
  icon?: ReactNode
  /** Left-aligned text, for fields outside an open card. */
  alignStart?: boolean
}

/** The pill input (`.input`): 52px, 17px text, centred while its card is open. */
export function FieldInput({ ref, invalid, icon, alignStart, className, ...props }: FieldInputProps) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-13 w-full rounded-full border-[1.5px] border-blue-600/22 bg-white px-5 text-[17px] text-slate-800 caret-orange-500 transition-[border-color,box-shadow] outline-none placeholder:text-[#8a94a6] focus:border-blue-600 focus:shadow-[0_0_0_4px_rgb(9_0_187/0.12)]",
        "aria-invalid:border-[#c81e1e] aria-invalid:shadow-[0_0_0_4px_rgb(200_30_30/0.1)]",
        alignStart ? "text-left" : "text-center",
        icon && "pr-12 pl-12",
        className,
      )}
      {...props}
    />
  )
  if (!icon) return input
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-slate-500">{icon}</span>
      {input}
    </div>
  )
}

/** The red line under a field (`.err`). It folds open when `message` is set; link it with aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: ReactNode }) {
  return (
    <div id={id} className={cn("gf-err", message && "gf-on")}>
      <div>
        {message && (
          <p className="m-0 flex items-start justify-center gap-1.5 pt-1.5 text-sm font-medium text-[#c81e1e]">
            <Icon name="alert" small className="mt-px" />
            <span>{message}</span>
          </p>
        )}
      </div>
    </div>
  )
}

export type ChoiceOption = { value: string; label: ReactNode; description?: ReactNode; lang?: string }

export type ChoiceTilesProps = {
  name: string
  /** The question, usually a `QuestionTitle`; it becomes the fieldset's legend. */
  legend: ReactNode
  options: ChoiceOption[]
  value: string | null
  onChange: (value: string) => void
  /**
   * `rows`: big radio rows with the tick on the right (`.choice`), for Day or Boarding.
   * `two` / `three` / `four`: the segmented grid (`.seg`), for the year or the relationship.
   */
  layout?: "rows" | "two" | "three" | "four"
  /** Segmented tiles only: 56px, the label in Exo 800 italic indigo, as the kit page shows a class choice. */
  big?: boolean
  describedBy?: string
  children?: ReactNode
}

/** Real radios drawn as pills. The fieldset keeps arrow-key movement and the legend. */
export function ChoiceTiles({ name, legend, options, value, onChange, layout = "rows", big, describedBy, children }: ChoiceTilesProps) {
  const radio = (o: ChoiceOption) => (
    <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} aria-describedby={describedBy} />
  )
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="w-full p-0">{legend}</legend>
      {layout === "rows" ? (
        options.map((o) => (
          <label key={o.value} className="gf-choice" lang={o.lang}>
            {radio(o)}
            <span className="gf-row">
              <span>
                <span className="gf-t">{o.label}</span>
                {o.description && <span className="gf-d">{o.description}</span>}
              </span>
              <span className="gf-tick">
                <Icon name="check" />
              </span>
            </span>
          </label>
        ))
      ) : (
        <div className={cn("gf-seg", `gf-${layout}`, big && "gf-big")}>
          {options.map((o) => (
            <label key={o.value} lang={o.lang}>
              {radio(o)}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {children}
    </fieldset>
  )
}

/**
 * The one-tap answer tile (`.pop`): a big Exo label with an optional tagline
 * above it ("Wazazi wengi huchagua") and the tick on the right. One tap
 * answers, so it is a toggle button, not a radio.
 */
export function DefaultTile({ label, tagline, pressed, onClick, describedBy }: { label: ReactNode; tagline?: ReactNode; pressed: boolean; onClick: () => void; describedBy?: string }) {
  return (
    <button type="button" className="gf-pop" aria-pressed={pressed} onClick={onClick} aria-describedby={describedBy}>
      <span className="gf-pt">
        {tagline && <small>{tagline}</small>}
        <b>{label}</b>
      </span>
      <span className="gf-tick">
        <Icon name="check" />
      </span>
    </button>
  )
}

export type ContinuePillProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode
  /** `go`: the orange next step, always ending with ›. `ghost`: the outlined alternative, e.g. "Ndiyo, ongeza mwanafunzi". */
  variant?: "go" | "ghost"
  /** A leading icon, for the ghost variant ("plus"). */
  icon?: IconName
  /** Shows a spinner and marks the button busy; clicks still reach `onClick`, so guard there. */
  pending?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** The full-width pill that moves the form on (`.btn.btn-go.wide`, or `.btn-ghost`). Exo italic. */
export function ContinuePill({ variant = "go", icon, pending, className, children, type = "button", ref, ...props }: ContinuePillProps) {
  const go = variant === "go"
  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={pending || props["aria-disabled"] || undefined}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-full px-6 font-exo text-lg font-semibold italic outline-none select-none focus-visible:ring-3 focus-visible:ring-blue-600/40",
        go
          ? "gf-go min-h-13 bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-600"
          : "gf-ghost min-h-16 rounded-[24px] border-[1.5px] border-blue-600/45 bg-transparent text-blue-600 transition-[background,transform] hover:bg-blue-50 active:scale-[0.96]",
        className,
      )}
      {...props}
    >
      {pending ? <span className="gf-btn-spin" aria-hidden="true" /> : icon && <Icon name={icon} />}
      <span>{children}</span>
      {go && !pending && <Icon name="right" />}
    </button>
  )
}

const NOTICE_TONES = {
  good: "bg-[#eefbf3] text-[#0b5a2d]",
  wait: "bg-[#fff6ee] text-[#8a3300]",
  bad: "bg-red-50 text-[#a11717]",
  info: "bg-blue-50 text-blue-900",
} as const

/** A tinted note (`.notice`): good, wait, bad or info, with a small icon. Left-aligned. */
export function NoticeBox({ tone = "info", icon, role, children, className }: { tone?: keyof typeof NOTICE_TONES; icon?: IconName | ReactNode; role?: "alert" | "status" | "note"; children: ReactNode; className?: string }) {
  const glyph = typeof icon === "string" ? <Icon name={icon as IconName} small className="mt-px" /> : (icon ?? <Icon name={tone === "good" ? "check" : "alert"} small className="mt-px" />)
  return (
    <p role={role} className={cn("m-0 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-left text-sm", NOTICE_TONES[tone], className)}>
      {glyph}
      <span>{children}</span>
    </p>
  )
}

/**
 * The limited-time note (`.offer`): clock icon, bold title, body, on the
 * orange tint. `pulse` plays the entrance and the clock's wiggle once.
 * `centred` stacks it for the success screen.
 */
export function OfferNote({ title, children, pulse, centred, className }: { title: ReactNode; children: ReactNode; pulse?: boolean; centred?: boolean; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "gf-offer m-0 flex w-full gap-3 rounded-[20px] border-[1.5px] border-orange-500/35 bg-[#fff4e8] px-4 py-3.5 text-[#6b3300]",
        centred ? "flex-col items-center text-center" : "items-start text-left",
        pulse && "gf-pulse",
        className,
      )}
    >
      <Icon name="clock" className={cn("gf-clk flex-none text-orange-500", !centred && "mt-0.5")} />
      <div>
        <b className="mb-0.5 block text-[15px] text-[#8a3f00]">{title}</b>
        <span className="text-sm leading-[1.45]">{children}</span>
      </div>
    </div>
  )
}

/** The outlined deep-orange "OFA YA MUDA MAALUM" pill (`.offerpill`). Opens the offer sheet. */
export function OfferPill({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      className={cn(
        "gf-offerpill inline-flex min-h-[30px] flex-none items-center gap-1.5 rounded-full border-[1.5px] border-orange-700 bg-[#fff4e8] px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-orange-700 uppercase outline-none hover:bg-[#ffe8d1] focus-visible:ring-3 focus-visible:ring-blue-600/40",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-orange-500" aria-hidden="true" />
      {children}
    </button>
  )
}

/** The small ⓘ button beside a discounted fee (`.ibtn`). 22px drawn, 44px to the finger. */
export function InfoButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={label}
      onClick={onClick}
      className={cn("gf-ibtn mr-1.5 inline-grid size-[22px] place-items-center rounded-full border-0 bg-transparent p-0 align-[-5px] text-orange-700 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40", className)}
    >
      <Icon name="info" className="size-[18px]" />
    </button>
  )
}

export type PriceAnchorProps = {
  /** "Bila code" */
  fullLabel: ReactNode
  /** "TZS 50,000" */
  fullAmount: ReactNode
  /** "Ukiwa na code" */
  codeLabel: ReactNode
  /** "Okoa TZS 10,000". Leave out until the live figure has arrived. */
  saving?: ReactNode
  /** The struck line, e.g. { from: "50,000", to: "40,000" }. Leave out until known. */
  was?: { from: ReactNode; to: ReactNode }
}

/**
 * The price box on the Discount code step (`.anchor`): the full fee on faint
 * orange on the left, the saving on faint green on the right with the small
 * struck "50,000 → 40,000" line. One column under 380px.
 */
export function PriceAnchor({ fullLabel, fullAmount, codeLabel, saving, was }: PriceAnchorProps) {
  return (
    <div className="gf-anchor">
      <div className="gf-full">
        <small>{fullLabel}</small>
        <b>{fullAmount}</b>
      </div>
      <div className="gf-save">
        <small>{codeLabel}</small>
        {saving && <b>{saving}</b>}
        {was && (
          <span className="gf-was">
            <s>{was.from}</s> → {was.to}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The application count (`.live-n.blk`): a centred white pill, Exo bold
 * italic, tabular figures. Change `bumpKey` when the number changes to play
 * the small rise.
 */
export function LiveCountPill({ children, bumpKey }: { children: ReactNode; bumpKey?: string | number }) {
  return (
    <b
      key={bumpKey}
      className={cn(
        "gf-live mx-auto my-2.5 table rounded-full border-[1.5px] border-orange-500/35 bg-white px-[18px] py-1 font-exo text-[22px] leading-[1.3] font-bold whitespace-nowrap text-orange-700 italic tabular-nums shadow-[0_6px_16px_-8px_rgb(238_115_0/0.5)]",
        bumpKey !== undefined && "gf-bump",
      )}
    >
      {children}
    </b>
  )
}
