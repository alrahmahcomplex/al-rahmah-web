import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./illustrations.css"

// The line illustrations of prototype v38, style C "Soft circle"
// (DESIGN.md, Illustrations): each picture sits on a Lavender Whisper circle,
// with white fills, an indigo line and one Peach Glow highlight; orange marks
// the sparkles. The paths are copied from the prototype (`IL`); do not redraw
// them. The prototype's speed bars are invisible in style C, so they are left out.

const CLOUD = "M42 76a15 15 0 0 1-2.5-29.8A19 19 0 0 1 75 42a15 15 0 0 1 8 34z"
const CUP = "M38 48h34v20a10 10 0 0 1-10 10H48a10 10 0 0 1-10-10z"
const TRAY = "M32 58l9-20h38l9 20v16a5 5 0 0 1-5 5H37a5 5 0 0 1-5-5z"
const CARD = "M30 26h48a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z"
const HANDLE = "M66.5 60.5l3.5-3.5 13 13a2.5 2.5 0 0 1-3.5 3.5z"
const PLANE = "M30 52l58-24-14 50-15-15z"

/** A twinkling orange plus. */
const Plus = ({ x, y }: { x: number; y: number }) => <path className="ill-ac ill-tw" d={`M${x} ${y - 3.5}v7M${x - 3.5} ${y}h7`} />

const SCENES = {
  /** Empty: nothing matches a search or a filter. */
  search: (
    <>
      <g className="ill-bob">
        <circle className="ill-wh" cx="52" cy="44" r="20" />
        <path className="ill-wh" d={HANDLE} />
        <circle className="ill-hl" cx="52" cy="44" r="13" />
        <circle className="ill-ln" cx="52" cy="44" r="20" />
        <path className="ill-ln" d={HANDLE} />
        <path className="ill-ln" d="M46.5 39.5a5.5 5.5 0 1 1 8 4.9c-1.5.8-2.5 2-2.5 3.6v1M52 55v.01" />
      </g>
      <Plus x={88} y={22} />
      <circle className="ill-ac ill-tw ill-d2" cx="24" cy="20" r="1.8" />
    </>
  ),
  /** Empty: nothing is due. */
  done: (
    <>
      <path className="ill-wh" d={CUP} />
      <circle className="ill-hl" cx="55" cy="63" r="8" />
      <path className="ill-ln" d={CUP} />
      <path className="ill-ln" d="M72 53h4a6.5 6.5 0 0 1 0 13h-4M32 84h48" />
      <g className="ill-steam">
        <path className="ill-ln" d="M47 40c-3-4 3-6 0-10" />
        <path className="ill-ln" d="M55 40c-3-4 3-6 0-10" />
        <path className="ill-ln" d="M63 40c-3-4 3-6 0-10" />
      </g>
      <Plus x={90} y={28} />
    </>
  ),
  /** Empty: no requests are waiting. */
  inbox: (
    <>
      <path className="ill-wh" d={TRAY} />
      <circle className="ill-hl" cx="60" cy="68" r="7" />
      <path className="ill-ln" d={TRAY} />
      <path className="ill-ln" d="M32 58h16l3 6h18l3-6h16" />
      <g className="ill-rays">
        <path className="ill-ac" d="M60 18v9" />
        <path className="ill-ac" d="M45 22l4 7" />
        <path className="ill-ac" d="M75 22l-4 7" />
      </g>
    </>
  ),
  /** Loading: the lens sweeps the list until the record opens. */
  finding: (
    <>
      <path className="ill-wh" d={CARD} />
      <path className="ill-ln" d={CARD} />
      <circle className="ill-ln" cx="38" cy="41" r="5" />
      <path className="ill-ln" d="M48 38h22M48 44h14" />
      <circle className="ill-ln" cx="38" cy="61" r="5" />
      <path className="ill-ln" d="M48 58h22M48 64h16" />
      <g className="ill-sweep">
        <circle className="ill-wh" cx="74" cy="56" r="11" />
        <circle className="ill-hl" cx="74" cy="56" r="7" />
        <circle className="ill-ln" cx="74" cy="56" r="11" />
        <path className="ill-ln" d="M82 64l9 9" />
      </g>
      <Plus x={98} y={20} />
    </>
  ),
  /** Working: the plane bobs and its trail runs until the batch is done. */
  sending: (
    <>
      <g className="ill-fly">
        <path className="ill-wh" d={PLANE} />
        <circle className="ill-hl" cx="66" cy="50" r="6" />
        <path className="ill-ln" d={PLANE} />
        <path className="ill-ln" d="M59 63l29-35M59 63v13l7-6" />
      </g>
      <path className="ill-ln ill-trail" d="M27 58c-7 7-16 8-19 1" />
      <Plus x={96} y={18} />
    </>
  ),
  /** Error: something went wrong, shown with Try again. */
  oops: (
    <>
      <g className="ill-bob">
        <path className="ill-wh" d={CLOUD} />
        <circle className="ill-hl" cx="47" cy="65" r="4" />
        <circle className="ill-hl" cx="75" cy="65" r="4" />
        <path className="ill-ln" d={CLOUD} />
        <path className="ill-ln" d="M51 55l5 5M56 55l-5 5M65 55l5 5M70 55l-5 5M56 69q4.5-3.5 9 0" />
      </g>
      <path className="ill-ac ill-tw" d="M88 24l4 4M92 24l-4 4" />
      <path className="ill-ac ill-tw ill-d2" d="M28 30l3 3M31 30l-3 3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IllustrationName = keyof typeof SCENES

export const ILLUSTRATION_NAMES = Object.keys(SCENES) as IllustrationName[]

/**
 * A line illustration for a moment between work: nothing to show (`search`,
 * `done`, `inbox`), waiting (`finding`), longer work (`sending`) or a failure
 * (`oops`). `size` is its width; the height is five sixths of it. Decorative:
 * the words beside it carry the meaning. It moves gently until it is removed,
 * and stands still under reduced motion.
 */
export function Illustration({ name, size = 140, className }: { name: IllustrationName; size?: number; className?: string }) {
  return (
    <svg
      className={cn("ill", className)}
      viewBox="0 0 120 100"
      width={size}
      height={Math.round((size * 100) / 120)}
      aria-hidden="true"
      focusable="false"
      data-illustration={name}
    >
      <circle className="ill-bg" cx="60" cy="54" r="44" />
      {SCENES[name]}
    </svg>
  )
}
