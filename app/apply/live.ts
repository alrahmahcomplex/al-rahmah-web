"use client"

import { useEffect, useState } from "react"

import { LIVE_APPLY_PATH, LIVE_APPLY_POLL_MS, type LiveApply } from "@/lib/live-apply"

// The Admission form's live figures, read from the public route once the page
// is up and again every 30 seconds while the tab is visible. A tab coming back
// into view reads at once. A failed read keeps the last good figures, and
// nothing here throws: the form simply states less.

const UNKNOWN: LiveApply = { applications: null, discount: null }

function parse(body: unknown): LiveApply | null {
  if (typeof body !== "object" || body === null) return null
  const { applications, discount } = body as Record<string, unknown>
  const figure = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
  return { applications: figure(applications), discount: figure(discount) }
}

export function useLiveApply(initial: LiveApply = UNKNOWN): LiveApply {
  const [live, setLive] = useState<LiveApply>(initial)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // One read at a time: a tab shown mid-read lets that read schedule the next.
    let reading = false

    async function read() {
      if (reading) return
      reading = true
      clearTimeout(timer)
      try {
        const response = await fetch(LIVE_APPLY_PATH, { signal: controller.signal })
        const next = response.ok ? parse(await response.json()) : null
        if (next) {
          // Keep a figure the last read had when this read lost it.
          setLive((last) => ({
            applications: next.applications ?? last.applications,
            discount: next.discount ?? last.discount,
          }))
        }
      } catch {
        // Offline, aborted or a bad answer: keep what the form shows.
      }
      reading = false
      if (controller.signal.aborted) return
      if (document.visibilityState === "visible") timer = setTimeout(read, LIVE_APPLY_POLL_MS)
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void read()
      else clearTimeout(timer)
    }

    void read()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return live
}
