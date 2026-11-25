"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"

import { Icon } from "./icons"
import { focusedTextBoxIn, keepShowingAfter } from "./keep-in-view"
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

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/**
 * `prefersReducedMotion()` for render code. It is false on the server and
 * while hydrating, then the browser's answer, so the server's HTML and the
 * first browser render always match (#334).
 */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}

/** Unfold on mount, fold before leaving. Returns the classes for the `li`. */
function useItemMotion(leaving: boolean | undefined, instant: boolean | undefined) {
  // The server can't know about reduced motion, so every item starts about
  // to unfold, in the browser too. Under reduced motion the classes are left
  // off instead: a first browser render that differed from the server's HTML
  // kept the server's classes and left the question folded (#334).
  const reduced = useReducedMotion()
  const [pre, setPre] = useState(!instant)
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

  return cn(((pre && !reduced) || leaving) && "gf-pre", ((moving && !reduced) || leaving) && "gf-moving", leaving && "gf-leaving")
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
 * Inside a staff stage it scrolls the stage's scroll area, the nearest
 * element marked `data-stage-scroll`; elsewhere it scrolls the window. The
 * screen is the part a phone keyboard leaves free, and a focused text box in
 * the step stays above the keyboard: the later scroll used to push it back
 * under the keyboard after `useKeepFocusInView` had brought it up.
 */
export function revealStep(li: HTMLElement) {
  const area = li.closest<HTMLElement>("[data-stage-scroll]")
  const go = () => {
    const behavior = prefersReducedMotion() ? "auto" : "smooth"
    const box = focusedTextBoxIn(li)
    // How far down to scroll so the step's head sits at 18% of `height`, when it is outside 6% to 36%.
    const plan = (top: number, height: number) => {
      const by = top > height * 0.06 && top < height * 0.36 ? 0 : top - height * 0.18
      return box ? keepShowingAfter(box, by) : by
    }
    if (area) {
      const by = plan(li.getBoundingClientRect().top - area.getBoundingClientRect().top, area.clientHeight)
      if (Math.abs(by) >= 1) area.scrollTo({ top: Math.max(0, area.scrollTop + by), behavior })
      return
    }
    const vv = window.visualViewport
    const by = plan(li.getBoundingClientRect().top - (vv?.offsetTop ?? 0), vv?.height ?? window.innerHeight)
    if (Math.abs(by) >= 1) window.scrollTo({ top: Math.max(0, window.scrollY + by), behavior })
  }
  go()
  window.setTimeout(go, foldMs() + 40)
}

/**
 * The folded answer line (`.sum`), one group per question (owner, #503
 * slice 4d, the Law of Proximity): the tick dot and the question's label on
 * the left; the answer on the right, with its action (usually a `ChangeLink`)
 * right under it, right-aligned too. A long answer wraps in its own column,
 * never under the label. Where the row is too narrow for two columns, the
 * three stack: label, answer, action. Without a label, the answer sits beside
 * the dot and the action under it on the right.
 *
 * `stacked` (owner, 25 Nov 2026, agent sign-up prototype v5 / Register Students
 * Rows): the question small and grey on top, its action on the same line at the
 * right (pass a `ChangeLink small`), and the answer under them, the only bold
 * text, left-aligned across the whole row. `sub` is a quiet line under the
 * answer; `none` puts an answer that says there is nothing ("None", "No code")
 * in plain grey, not bold.
 * Without a label, the answer takes the top line beside its action.
 */
export function SummaryRow({
  label,
  value,
  action,
  icon,
  stacked = false,
  sub,
  none = false,
}: {
  label?: ReactNode
  value: ReactNode
  action?: ReactNode
  icon?: ReactNode
  stacked?: boolean
  sub?: ReactNode
  none?: boolean
}) {
  const dot = <span className="grid size-7 flex-none place-items-center rounded-full bg-blue-50 text-blue-600">{icon ?? <Icon name="check" small />}</span>
  const answer = (
    <span className={cn("text-base leading-[1.35] [overflow-wrap:anywhere]", none ? "font-normal text-slate-600" : "font-semibold text-slate-800")} data-summary-value>
      {value}
    </span>
  )
  const subLine = sub ? (
    <span className="text-[13.5px] leading-[1.35] text-slate-600 [overflow-wrap:anywhere]" data-summary-sub>
      {sub}
    </span>
  ) : null
  if (stacked) {
    return (
      <div className="flex items-start gap-3 py-3 text-left" data-summary-row data-summary-stacked>
        {dot}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {label ? (
            <>
              <div className="flex min-w-0 items-baseline gap-2.5">
                <span className="min-w-0 flex-1 text-[13px] leading-[1.35] text-slate-500 [overflow-wrap:anywhere]" data-summary-label>
                  {label}
                </span>
                {action}
              </div>
              {answer}
            </>
          ) : (
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span className="min-w-0 flex-1">{answer}</span>
              {action}
            </div>
          )}
          {subLine}
        </div>
      </div>
    )
  }
  if (!label) {
    return (
      <div className="flex min-h-16 flex-col gap-1 py-3 text-left" data-summary-row>
        <div className="flex min-w-0 items-center gap-3">
          {dot}
          {answer}
        </div>
        {action && <div className="self-end">{action}</div>}
      </div>
    )
  }
  return (
    <div className="@container py-3 text-left" data-summary-row>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-start gap-x-3 gap-y-1 @max-[19rem]:grid-cols-1">
        <div className="flex min-h-7 min-w-0 items-center gap-3">
          {dot}
          <span className="text-sm leading-[1.35] text-slate-600 [overflow-wrap:anywhere]" data-summary-label>
            {label}
          </span>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5 pt-0.5 text-right @max-[19rem]:items-start @max-[19rem]:pl-10 @max-[19rem]:text-left" data-summary-answer>
          {answer}
          {subLine}
          {action}
        </div>
      </div>
    </div>
  )
}
