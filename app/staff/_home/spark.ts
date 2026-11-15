// The 7-day line under a stat card's number (#323): a smooth curve through
// one point a day that never overshoots between two days (monotone cubic),
// so a quiet day never dips below zero or a busy one above its count.

export const SPARK_WIDTH = 200
export const SPARK_HEIGHT = 64
const PAD = 7

export type SparkShape = {
  /** The line, in a SPARK_WIDTH × SPARK_HEIGHT box. */
  line: string
  /** The line closed down to the bottom edge, for the soft fill under it. */
  area: string
  /** Each point as a percentage of the box, for the dots. */
  dots: { left: number; top: number }[]
}

const round = (n: number) => Math.round(n * 10) / 10

export function sparkShape(values: readonly number[]): SparkShape {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? SPARK_WIDTH / (values.length - 1) : 0
  const points = values.map((value, i) => [i * step, PAD + (SPARK_HEIGHT - 2 * PAD) * (1 - value / max)] as const)

  // The slope at each point: flat at a peak or a valley, else the harmonic
  // mean of the slopes either side (Fritsch–Carlson).
  const slopes = points.map(([x, y], i) => {
    const before = points[i - 1]
    const after = points[i + 1]
    const left = before ? (y - before[1]) / (x - before[0]) : null
    const right = after ? (after[1] - y) / (after[0] - x) : null
    if (left === null) return right ?? 0
    if (right === null) return left
    return left * right <= 0 ? 0 : 2 / (1 / left + 1 / right)
  })

  let line = `M${round(points[0][0])},${round(points[0][1])}`
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const dx = (bx - ax) / 3
    line += ` C${round(ax + dx)},${round(ay + slopes[i - 1] * dx)} ${round(bx - dx)},${round(by - slopes[i] * dx)} ${round(bx)},${round(by)}`
  }
  const last = points[points.length - 1]
  return {
    line,
    area: `${line} L${round(last[0])},${SPARK_HEIGHT} L0,${SPARK_HEIGHT} Z`,
    dots: points.map(([x, y]) => ({ left: round((x / SPARK_WIDTH) * 100), top: round((y / SPARK_HEIGHT) * 100) })),
  }
}
