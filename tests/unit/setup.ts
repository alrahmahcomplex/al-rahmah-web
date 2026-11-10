import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, vi } from "vitest"

afterEach(() => cleanup())

// The guided form scrolls a newly opened step into place a second time on a
// timer, 340 ms later (`revealStep` in components/guided-form/stack.tsx), and
// nothing cancels it. A test file that ends sooner leaves the timer to fire
// once jsdom is gone: "ReferenceError: window is not defined", which fails
// the run though every test passed. Each file waits the timer out here.
// Remove this when the component cancels its timer on unmount.
afterAll(async () => {
  vi.useRealTimers()
  await new Promise((resolve) => setTimeout(resolve, 400))
})
