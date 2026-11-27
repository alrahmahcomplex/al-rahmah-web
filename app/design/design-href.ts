"use client"

import { useSyncExternalStore } from "react"

const noSubscribe = () => () => {}
const browserBase = () => (window.location.pathname === "/design" || window.location.pathname.startsWith("/design/") ? "/design" : "")

/**
 * Where the design pages live in this browser: "" on design.alrahmahcomplex.or.tz,
 * which serves them at its root, "/design" on localhost and Previews. The
 * pages are static, drawn once with "/design"; the browser's own address
 * takes over once the page is live, so hydration matches.
 */
export function useDesignBase(): string {
  return useSyncExternalStore(noSubscribe, browserBase, () => "/design")
}

/** A design page's address in this browser: "" is the Design system page. */
export function useDesignHref(page: "" | "/connect"): string {
  return `${useDesignBase()}${page}` || "/"
}
