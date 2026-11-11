import { cn } from "@/lib/utils"

/** The four scenes in public/illustrations/ (DESIGN.md, Illustrations). */
export type IllustrationName = "empty" | "loading" | "finished" | "front-desk"

/** 130px for Empty, 150px for Loading and Finished; the prototype's default is 140px. */
export type IllustrationSize = 130 | 140 | 150

// Each file's frame is 144 × 112 units around the prototype's 128-unit box
// (scripts/illustrations.mjs, FRAME), so the box is laid out at `size` and
// the frame's extra 8 units a side hang over it, as the prototype's
// overflow: visible does.
const BOX = 128
const FRAME_WIDTH = 144
const FRAME_HEIGHT = 112

/**
 * An isometric scene for a moment between work: nothing to show, waiting,
 * finished, or the front desk. Decorative: the words beside it carry the
 * meaning. The bob and its reduced-motion rule live inside the SVG file.
 */
export function Illustration({ name, size = 140, className }: { name: IllustrationName; size?: IllustrationSize; className?: string }) {
  const scale = size / BOX
  return (
    <span className={cn("mx-auto block", className)} style={{ width: size, height: FRAME_HEIGHT * scale }}>
      {/* A static file through <img>, so it is cached and its animation runs inside it (spec #316); next/image would add nothing for an SVG. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/illustrations/${name}.svg`}
        alt=""
        width={FRAME_WIDTH * scale}
        height={FRAME_HEIGHT * scale}
        draggable={false}
        className="block max-w-none"
        style={{ marginLeft: ((BOX - FRAME_WIDTH) / 2) * scale }}
      />
    </span>
  )
}
