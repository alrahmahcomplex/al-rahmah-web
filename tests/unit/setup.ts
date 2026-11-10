import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, vi } from "vitest"

// The guided form scrolls a newly opened step into place a second time on a
// timer, 340 ms later (`revealStep` in components/guided-form/stack.tsx), and
// nothing cancels it. A test file that ends sooner leaves the timer to fire
// once jsdom is gone: "ReferenceError: window is not defined", which fails
// the run though every test passed. A file that rendered a guided step waits
// the timer out before its environment goes. Files that rendered none do not
// wait. Remove this when the component cancels its timer on unmount.
let renderedGuidedStep = false

afterEach(() => {
  // A test file can ask for the node environment, which has no document.
  renderedGuidedStep ||= typeof document !== "undefined" && document.querySelector(".gf-step") !== null
  cleanup()
})

afterAll(async () => {
  if (!renderedGuidedStep) return
  vi.useRealTimers()
  await new Promise((resolve) => setTimeout(resolve, 400))
})
