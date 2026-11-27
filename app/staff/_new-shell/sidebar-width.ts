// The new sidebar's open width (DESIGN.md, The sidebar, Resize), as pure
// arithmetic over what the browser measures, so it can be tested.

/** The width the widest limit is counted from. */
export const SIDEBAR_BASE = 252
/** The folded sidebar. */
export const FOLDED_WIDTH = 60
/** The open sidebar is never narrower (owner, design site round, 27 Nov 2026: more room). */
export const OPEN_MIN = 212
/** Before anything is measured: the open sidebar's first width. */
export const FIRST_WIDTH = OPEN_MIN
/** The brand title's size, in px, at the widest and the narrowest. */
export const TITLE_MAX = 14
export const TITLE_MIN = 11
/** The space kept after the brand title. */
export const TITLE_GAP = 8
/** Each arrow key moves the edge this far. */
export const KEY_STEP = 8

export type SidebarMeasures = {
  /** A row's side padding and the gap between its icon and label. */
  rowPadding: number
  rowGap: number
  iconSize: number
  /** The widest label, each in its own font (the current one is Exo). */
  longestLabel: number
  /** The white frame's padding before the sidebar. */
  framePadding: number
  /** Where the brand title starts, and its width at TITLE_MAX. */
  titleLeft: number
  titleWidth: number
  /** The page's side padding in the stage, and the page column's widest. */
  pagePadding: number
  pageMax: number
  /** The stage's width with the sidebar at SIDEBAR_BASE. */
  stageAtBase: number
  /** A floor under the narrowest, such as OPEN_MIN. */
  openMin?: number
}

export type SidebarLimits = { min: number; max: number }

/**
 * The narrowest is the largest of: the width that leaves the same gap after
 * the longest label as before the icons, the one that fits the brand title
 * at its smallest size plus a gap, and `openMin`. The widest is SIDEBAR_BASE
 * plus half the distance from the stage's edge to the page column.
 */
export function sidebarLimits(m: SidebarMeasures): SidebarLimits {
  const byLabels = m.rowPadding + m.iconSize + m.rowGap + m.longestLabel + m.framePadding + m.rowPadding
  const byTitle = m.titleLeft + (m.titleWidth * TITLE_MIN) / TITLE_MAX + TITLE_GAP
  const min = Math.ceil(Math.max(byLabels, byTitle, m.openMin ?? 0))
  const toPage = m.pagePadding + Math.max(0, (m.stageAtBase - 2 * m.pagePadding - m.pageMax) / 2)
  return { min, max: Math.max(min, Math.floor(SIDEBAR_BASE + toPage / 2)) }
}

/** A width held within the limits, in whole pixels. */
export function clampWidth(width: number, { min, max }: SidebarLimits): number {
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : min)))
}

/** The brand title's size at `width`: 14px when it fits, down to 11px. */
export function titleSize(width: number, titleLeft: number, titleWidth: number): number {
  if (titleWidth <= 0) return TITLE_MAX
  return Math.min(TITLE_MAX, Math.max(TITLE_MIN, (TITLE_MAX * (width - titleLeft - TITLE_GAP)) / titleWidth))
}
