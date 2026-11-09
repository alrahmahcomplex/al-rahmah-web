"use client"

import { LazyMotion, MotionConfig, domAnimation } from "motion/react"
import type { ReactNode } from "react"

// The one place motion is switched on, around the staff pages. Only the small
// domAnimation feature set loads, and `strict` refuses the full `motion.*`
// components, so animations use `m.*`. With reducedMotion "user", someone who
// asked their device for less motion gets no movement, only fades.
//
// Motion is for two things only: steps changing inside a sheet (with
// AnimatePresence) and list rows being added or removed. 150-250 ms,
// exponential ease-out. Nothing on page load. The SuccessMark and the loader
// animate in plain CSS, so they show even outside this provider.
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}
