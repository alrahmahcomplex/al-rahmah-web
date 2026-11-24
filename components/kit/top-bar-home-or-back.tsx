"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"

import "./agents-parts.css"
import { RoundButton } from "./button"
import "./kit.css"

export type TopBarHomeOrBackProps = {
  /** When true, draws the 40px round logo link to `homeHref`; otherwise a 40px Back button. */
  onHome: boolean
  homeHref: string
  homeLabel: string
  backLabel: string
  /** Where Back goes if there is no same-origin history entry, or when `onBack` is omitted. */
  backFallbackHref?: string
  /** Hide the round logo at desktop widths (>=861px) where the sidebar already holds it. */
  phoneOnlyLogo?: boolean
  onBack?: () => void
  className?: string
}

/**
 * The top bar's logo↔back swap (prototype v5, #539): on Home a 40px round
 * logo link (hidden on wide screens when the sidebar is visible), on every
 * other page a 40px round Back button.
 */
export function TopBarHomeOrBack({
  onHome,
  homeHref,
  homeLabel,
  backLabel,
  backFallbackHref,
  phoneOnlyLogo = true,
  onBack,
  className,
}: TopBarHomeOrBackProps) {
  const router = useRouter()

  if (onHome) {
    return (
      <Link
        href={homeHref}
        aria-label={homeLabel}
        data-phone-only={phoneOnlyLogo ? "" : undefined}
        className={cn("kit-tb-home", className)}
      >
        <Image src="/brand/logo-round.png" alt="" width={34} height={34} priority />
      </Link>
    )
  }

  return (
    <RoundButton
      icon="back"
      size={40}
      label={backLabel}
      className={className}
      onClick={() => {
        if (onBack) {
          onBack()
          return
        }
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back()
        } else {
          router.push(backFallbackHref ?? homeHref)
        }
      }}
    />
  )
}
