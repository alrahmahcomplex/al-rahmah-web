import { ICONS, type IconName } from "@/components/icons/registry"
import { cn } from "@/lib/utils"

export type { IconName }

/**
 * A decorative line icon from the shared registry (components/icons), drawn
 * the way the Admission form always drew it: both layers in the text colour,
 * no highlight circle. 20px, or 16px with `small`.
 */
export function Icon({ name, small, className }: { name: IconName; small?: boolean; className?: string }) {
  const { outline, detail } = ICONS[name]
  return (
    <svg className={cn("gf-icon", small && "gf-s", className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {outline}
      {detail}
    </svg>
  )
}
