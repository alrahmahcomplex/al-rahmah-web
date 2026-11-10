"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"

import { Icon } from "./icons"
import { foldMs, prefersReducedMotion } from "./motion"
import "./guided-form.css"

type ItemProps = { leaving?: boolean; instant?: boolean }
type Keyed = ReactElement<ItemProps> & { key: string }

/**
 * The folding list (`ol.stack`). Children are `GuidedStep`, `GuidedHead` and
 * `GuidedNote`, each with a stable `key`. A child that disappears folds shut
 * before it leaves; a new one unfolds into place (`.item.pre` / `.leaving`).
 * Pass `instant` to skip both, e.g. when the whole form restarts.
 */
export function GuidedStack({ children, instant = false, className }: { children: ReactNode; instant?: boolean; className?: string }) {
  const current = Children.toArray(children).filter(isValidElement) as Keyed[]
  const prev = useRef<Keyed[]>(current)
  const [leaving, setLeaving] = useState<{ el: Keyed; after: string | null }[]>([])
  // Each batch of leaving items keeps its own removal timer, so a list that
  // changes again mid-fold doesn't cancel an earlier batch's removal.
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  useLayoutEffect(() => {
    const keys = new Set(current.map((c) => c.key))
    const gone: { el: Keyed; after: string | null }[] = []
    prev.current.forEach((el, i) => {
      if (!keys.has(el.key)) gone.push({ el, after: i > 0 ? prev.current[i - 1].key : null })
    })
    prev.current = current
    if (gone.length === 0 || instant || foldMs() === 0) return
    setLeaving((list) => [...list.filter((l) => !keys.has(l.el.key)), ...gone])
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== timer)
      setLeaving((list) => list.filter((l) => !gone.some((g) => g.el.key === l.el.key)))
    }, foldMs())
    timers.current.push(timer)
    // `current` changes identity every render; the key list is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.map((c) => c.key).join("|"), instant])

  const out: ReactElement[] = []
  const pending = leaving.filter((l) => !current.some((c) => c.key === l.el.key))
  pending.filter((l) => l.after === null).forEach((l) => out.push(cloneElement(l.el, { leaving: true })))
  for (const el of current) {
    out.push(instant ? cloneElement(el, { instant: true }) : el)
    pending.filter((l) => l.after === el.key).forEach((l) => out.push(cloneElement(l.el, { leaving: true })))
  }
  // Anything whose neighbour also left goes to the end, still folding.
  pending
    .filter((l) => l.after !== null && !current.some((c) => c.key === l.after))
    .forEach((l) => out.push(cloneElement(l.el, { leaving: true })))

  return <ol className={cn("gf-stack", className)}>{out}</ol>
}

/** Unfold on mount, fold before leaving. Returns the classes for the `li`. */
function useItemMotion(leaving: boolean | undefined, instant: boolean | undefined) {
  const [pre, setPre] = useState(!instant && !prefersReducedMotion())
  const [moving, setMoving] = useState(pre)

  useLayoutEffect(() => {
    if (!pre) return
    // One frame at 0fr, then let the grid row grow.
    const frame = requestAnimationFrame(() => setPre(false))
    return () => cancelAnimationFrame(frame)
  }, [pre])

  useEffect(() => {
    if (pre || !moving) return
    const timer = window.setTimeout(() => setMoving(false), foldMs())
    return () => window.clearTimeout(timer)
  }, [pre, moving])

  return cn((pre || leaving) && "gf-pre", (moving || leaving) && "gf-moving", leaving && "gf-leaving")
}

export type StepState = "open" | "folded"

export type GuidedStepProps = ItemProps & {
  /** `open` shows the question; `folded` shows the one-line summary. */
  state: StepState
  /** The folded line, usually a `SummaryRow`. Leave it out until the step is answered. */
  summary?: ReactNode
  /** The open question. Keep it rendered while folded so the fold can animate. */
  children: ReactNode
  /**
   * Called after the step opens (not on first paint unless `openOnMount`),
   * with the `li`. Focus the field or the question title here, then call
   * `revealStep(li)`.
   */
  onOpened?: (li: HTMLLIElement) => void
  /** Also call `onOpened` when the step first renders open. */
  openOnMount?: boolean
  className?: string
  id?: string
}

/**
 * One question in the stack (`li.item.step`). Open: the question body unfolds
 * (`.fold`); folded: the summary line shows (`.sum-w`). The hidden half is
 * `inert`, so Tab reaches only the open question and the Change links.
 */
export function GuidedStep({ state, summary, children, onOpened, openOnMount = false, leaving, instant, className, id }: GuidedStepProps) {
  const ref = useRef<HTMLLIElement>(null)
  const motion = useItemMotion(leaving, instant)
  const [settled, setSettled] = useState(true)
  const last = useRef<StepState | null>(null)
  const opened = useRef(onOpened)
  useLayoutEffect(() => {
    opened.current = onOpened
  })

  useEffect(() => {
    const before = last.current
    last.current = state
    if (before === state) return
    if (before !== null) setSettled(false)
    const timer = window.setTimeout(() => setSettled(true), foldMs())
    // A folding-out copy of a step (`leaving`) mounts open too; it must not
    // take focus from the question that is really open.
    if (state === "open" && !leaving && (before !== null || openOnMount) && ref.current) opened.current?.(ref.current)
    return () => window.clearTimeout(timer)
  }, [state, openOnMount, leaving])

  const open = state === "open" && !leaving
  const folded = state === "folded" && !leaving

  return (
    <li
      ref={ref}
      id={id}
      data-state={state}
      className={cn("gf-item gf-step", open && "gf-open", folded && "gf-folded", settled && "gf-settled", motion, className)}
      inert={leaving || undefined}
    >
      <div className="gf-item-in">
        <div className="gf-sum-w" inert={!folded || undefined}>
          <div>{summary}</div>
        </div>
        <div className="gf-fold" inert={!open || undefined}>
          <div>
            <div className="gf-body">{children}</div>
          </div>
        </div>
      </div>
    </li>
  )
}

/** A group title in the stack ("Mwanafunzi", "Msimamizi", "Usaili"): `li.item.head` with `h3.kid`. */
export function GuidedHead({ children, aside, leaving, instant, as: Tag = "h3", className }: ItemProps & { children: ReactNode; aside?: ReactNode; as?: "h2" | "h3" | "h4"; className?: string }) {
  const motion = useItemMotion(leaving, instant)
  return (
    <li className={cn("gf-item gf-head", motion, className)} inert={leaving || undefined}>
      <div className="gf-item-in">
        <Tag className="m-0 font-exo text-[17px] leading-[1.3] font-extrabold text-blue-600 italic">{children}</Tag>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
    </li>
  )
}

/** A free row in the stack, e.g. a `NoticeBox` or a student's folded line (`li.item.note`). */
export function GuidedNote({ children, leaving, instant, className }: ItemProps & { children: ReactNode; className?: string }) {
  const motion = useItemMotion(leaving, instant)
  return (
    <li className={cn("gf-item gf-note", motion, className)} inert={leaving || undefined}>
      <div className="gf-item-in">{children}</div>
    </li>
  )
}

/**
 * Scrolls so a newly opened step sits in the top third of the screen, once
 * now and again when the fold has finished (the prototype's `scrollToItem`).
 */
export function revealStep(li: HTMLElement) {
  const go = () => {
    const top = li.getBoundingClientRect().top
    if (top > window.innerHeight * 0.06 && top < window.innerHeight * 0.36) return
    window.scrollTo({ top: Math.max(0, top + window.scrollY - window.innerHeight * 0.18), behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }
  go()
  window.setTimeout(go, foldMs() + 40)
}

/**
 * The folded answer line (`.sum`): tick dot, small label over the value on
 * the left, the action (usually a `ChangeLink`) on the right.
 */
export function SummaryRow({ label, value, action, icon }: { label?: ReactNode; value: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left">
      <span className="grid size-7 flex-none place-items-center rounded-full bg-blue-50 text-blue-600">{icon ?? <Icon name="check" small />}</span>
      <div className="flex min-w-0 flex-[1_1_10em] flex-col">
        {label && <span className="text-[13px] leading-[1.3] text-slate-500">{label}</span>}
        <span className="text-base leading-[1.35] font-semibold [overflow-wrap:break-word] text-slate-800">{value}</span>
      </div>
      {action && <div className="ml-auto flex-none">{action}</div>}
    </div>
  )
}
