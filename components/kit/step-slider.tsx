"use client"

import { useState, type CSSProperties, type InputHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

import "./picked.css"

export type StepSliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> & {
  min: number
  max: number
  step: number
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  /** Follows each step's number, under the track and for a screen reader: "%" gives "10%". */
  unit?: string
}

/**
 * Slider B, steps with labels (prototype v38): a native range input whose
 * track fills in indigo up to the thumb, with every step's value written
 * under it. For a value inside a known range, such as a discount percent;
 * put the chosen value in words beside it, and keep a typed field where the
 * exact number matters. Name it with a <label htmlFor={id}> or aria-label.
 */
export function StepSlider({ min, max, step, value: valueProp, defaultValue, onValueChange, unit = "", className, ...props }: StepSliderProps) {
  const [own, setOwn] = useState(defaultValue ?? min)
  const value = valueProp ?? own
  const stops = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className={cn("kit-sld", className)} style={{ "--p": `${fill}%` } as CSSProperties}>
      <input
        {...props}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${value}${unit}`}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (valueProp === undefined) setOwn(next)
          onValueChange?.(next)
        }}
      />
      <div className="kit-sld-stops" aria-hidden="true">
        {stops.map((stop) => (
          <span key={stop}>
            {stop}
            {unit}
          </span>
        ))}
      </div>
    </div>
  )
}
