"use client"

import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

/**
 * The file area (prototype version 18): a dashed 20px-corner area to drop a
 * file on, with an upload icon, a title, a hint and a "Choose file" ghost
 * button. While a file is dragged over it the area turns Lavender Whisper
 * with a solid indigo line; once a file is chosen its name replaces the
 * title, in indigo. The file input is a real one, so it works uncontrolled
 * inside a form with `name`, `accept` and `required`.
 */
export function FilePicker({
  id,
  name,
  accept,
  required,
  disabled,
  title,
  hint,
  chooseLabel,
  inputLabel,
  onFileChange,
  "aria-describedby": describedBy,
  className,
  ref,
}: {
  id?: string
  name?: string
  /** What the screen accepts today, such as ".csv,text/csv". */
  accept?: string
  required?: boolean
  disabled?: boolean
  /** The first line, until a file is chosen ("Drop the CSV here or choose a file"). */
  title: ReactNode
  hint?: ReactNode
  /** The button's words ("Choose file"). */
  chooseLabel: string
  /** Names the file input ("CSV file") when no `<label htmlFor={id}>` does. */
  inputLabel?: string
  /** Called with the chosen file, or null when it is cleared. */
  onFileChange?: (file: File | null) => void
  "aria-describedby"?: string
  className?: string
  ref?: Ref<HTMLInputElement>
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // A form's reset empties the input; the title comes back with it.
  useEffect(() => {
    const form = input.current?.form
    if (!form) return
    const reset = () => {
      setFile(null)
      onFileChange?.(null)
    }
    form.addEventListener("reset", reset)
    return () => form.removeEventListener("reset", reset)
  }, [onFileChange])

  const take = (files: FileList | null) => {
    const chosen = files?.[0] ?? null
    setFile(chosen?.name ?? null)
    onFileChange?.(chosen)
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled || !input.current || !event.dataTransfer.files.length) return
    // The dropped file goes into the real input, so the form posts it.
    const transfer = new DataTransfer()
    transfer.items.add(event.dataTransfer.files[0])
    input.current.files = transfer.files
    take(input.current.files)
  }

  return (
    <div
      className={cn("kit-file", className)}
      data-drag={dragging ? "" : undefined}
      data-has={file ? "" : undefined}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <Icon name="upload" className="kit-file-ic" />
      <p className="kit-file-t">{file ?? title}</p>
      {hint && <p className="kit-file-hint">{hint}</p>}
      <button type="button" className="kit-btn kit-ghost kit-sm" disabled={disabled} onClick={() => input.current?.click()}>
        <span>{chooseLabel}</span>
      </button>
      <input
        ref={(el) => {
          input.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        aria-label={inputLabel}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="kit-file-in"
        onChange={(event) => take(event.target.files)}
      />
    </div>
  )
}
