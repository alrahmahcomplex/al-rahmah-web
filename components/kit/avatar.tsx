import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

import "./picked.css"

export type AvatarTone = "indigo" | "orange" | "green"
export type AvatarSize = 24 | 32 | 36 | 40 | 56

const TONES: AvatarTone[] = ["indigo", "orange", "green"]

/**
 * Avatars B, soft tints (prototype v38): initials in Exo on a soft circle.
 * `indigo` is Rahmah Indigo on Lavender Whisper, `orange` Sunrise Deep on the
 * orange tint, `green` Go green on the green tint. Sizes 24, 32, 40 and 56.
 * With `name` it is an image of that person; without, it is decoration.
 */
export function Avatar({ initials, name, size = 40, tone = "indigo", className }: { initials: string; name?: string; size?: AvatarSize; tone?: AvatarTone; className?: string }) {
  return (
    <span
      className={cn("kit-av", className)}
      data-tone={tone === "indigo" ? undefined : tone}
      style={{ "--s": `${size}px` } as CSSProperties}
      role={name ? "img" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      title={name}
    >
      {initials}
    </span>
  )
}

/**
 * A stack of 36px avatars, each overlapping the one before, tints in turn
 * (indigo, orange, green), then a "+3" for the people not shown. `label`
 * names the whole group, such as "Rehema M., Asha Saidi and 5 others".
 */
export function AvatarGroup({ people, max = 4, label, className }: { people: { initials: string }[]; max?: number; label: string; className?: string }) {
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span role="img" aria-label={label} className={cn("kit-avg", className)}>
      {shown.map((p, i) => (
        <Avatar key={i} initials={p.initials} size={36} tone={TONES[i % TONES.length]} />
      ))}
      {more > 0 && (
        <span className="kit-av" data-more="" style={{ "--s": "36px" } as CSSProperties} aria-hidden="true">
          +{more}
        </span>
      )}
    </span>
  )
}
