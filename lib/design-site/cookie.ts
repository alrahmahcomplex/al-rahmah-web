// The cookie that remembers a browser that gave the design site's password
// (lib/design-site/token.ts). Its own file, with no imports, because
// lib/site-hosts.ts needs the name and client code imports that file.
export const DESIGN_COOKIE = "design_pass"
/** How long a browser stays open (owner, 27 Nov 2026): 30 days. */
export const DESIGN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
