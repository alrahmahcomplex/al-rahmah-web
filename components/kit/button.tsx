"use client"

import Link from "next/link"
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react"

import { Icon, type IconName } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

export type ButtonVariant = "go" | "ghost"
export type ButtonSize = "default" | "small" | "wide"

type Look = {
  /** `go`: the one orange next step on a screen. `ghost`: the other way forward. */
  variant?: ButtonVariant
  /** `default` 44px, `small` 36px for actions inside a card or header, `wide` full width at the foot of a task card or sheet. */
  size?: ButtonSize
  /** A leading icon, such as "plus". */
  icon?: IconName
  /** Ends the label with the `right` chevron. A Continue button always has it. */
  chevron?: boolean
}

function lookClass({ variant = "go", size = "default" }: Look, className?: string) {
  return cn("kit-btn", variant === "go" ? "kit-go" : "kit-ghost", size === "small" && "kit-sm", size === "wide" && "kit-wide", className)
}

function Inside({ icon, chevron, children }: { icon?: IconName; chevron?: boolean; children: ReactNode }) {
  return (
    <>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
      {chevron && <Icon name="right" />}
    </>
  )
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  Look & {
    children: ReactNode
    /**
     * The action is running. Pass the label that says so ("Saving…") as
     * `children` in the same render. The button stays focusable and in the
     * tab order, refuses clicks and form submits, and is announced busy.
     */
    pending?: boolean
    ref?: Ref<HTMLButtonElement>
  }

/** The kit's one button (DESIGN.md, Buttons): Go, Ghost, Small and Wide. Exo 600 italic in a full pill. */
export function Button({ variant, size, icon, chevron, pending, className, children, type = "button", onClick, ref, ...props }: ButtonProps) {
  const refuse = pending || props["aria-disabled"] === true || props["aria-disabled"] === "true"
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      aria-busy={pending || undefined}
      aria-disabled={refuse || undefined}
      className={lookClass({ variant, size }, className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (refuse) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      <Inside icon={icon} chevron={chevron && !pending}>
        {children}
      </Inside>
    </button>
  )
}

export type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> & Look & { href: string; children: ReactNode }

/** A link drawn as a kit button, for a next step that is a page ("Open Applicants"). */
export function ButtonLink({ variant, size, icon, chevron, className, children, href, ...props }: ButtonLinkProps) {
  return (
    <Link href={href} {...props} className={lookClass({ variant, size }, className)}>
      <Inside icon={icon} chevron={chevron}>
        {children}
      </Inside>
    </Link>
  )
}

export type RoundButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: IconName
  /** The button's name; the icon itself is hidden. */
  label: string
  /** 44px outlined in a guided form, 40px outlined in the top bar, 36px borderless to close a sheet. */
  size?: 44 | 40 | 36
  /**
   * Something it controls is on, such as a filter: its icon keeps its two
   * colours on a Lavender Whisper circle with the stronger line. The name
   * stays the same; say what is on elsewhere on the screen.
   */
  on?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** A round icon button (Back, Start over, Menu, the bell, Close). Its icon turns active on hover. */
export function RoundButton({ icon, label, size = 44, on, className, type = "button", ref, ...props }: RoundButtonProps) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} data-size={size} data-on={on ? "" : undefined} data-icon-host="" className={cn("kit-round", className)} {...props}>
      <Icon name={icon} />
    </button>
  )
}

export type TextLinkProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { children: ReactNode; ref?: Ref<HTMLButtonElement> }

/** The underlined indigo text button ("Edit", "Add", "Clear"). */
export function TextLink({ className, type = "button", ref, children, ...props }: TextLinkProps) {
  return (
    <button ref={ref} type={type} className={cn("kit-link", className)} {...props}>
      {children}
    </button>
  )
}
