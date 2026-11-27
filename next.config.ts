import type { NextConfig } from "next";

import { designPassword, designToken } from "./lib/design-site/token";
import { LANGUAGE_STATE_PREFIX, languageStateRewrites } from "./lib/language-state";
import {
  agentsHostRewrites,
  appRootRedirects,
  crossHostRedirects,
  designHostHeaders,
  designRedirects,
  designRewrites,
  movedAgentStudentsRedirect,
  movedSignInRedirects,
  rootEmailLinkRedirects,
} from "./lib/site-hosts";

// The design site's gate token, from DESIGN_SITE_PASSWORD at build time
// (lib/design-site/token.ts). No password: the design pages stay locked.
const designPass = designPassword();
const designGateToken = designPass ? designToken(designPass) : null;

const nextConfig: NextConfig = {
  // llms.txt and the MCP server read the design system from the code itself
  // (lib/design-site/content.ts), so those files go with their functions.
  outputFileTracingIncludes: {
    "/design-api/*": [
      "./DESIGN.md",
      "./app/tokens.css",
      "./app/layout.tsx",
      "./app/staff/_new-shell/**/*",
      "./components/kit/**/*",
      "./components/icons/**/*",
      "./components/illustrations/**/*",
      "./components/guided-form/**/*",
    ],
  },
  experimental: {
    // Makes app/staff/forbidden.tsx a forbidden() boundary. Staff pages return
    // that page themselves rather than calling forbidden() (#441).
    authInterrupts: true,
  },
  async headers() {
    // A page's address can hold a sign-in link token, a Discount code or a
    // name staff searched for. The next page, and anything measuring it,
    // learns only which site the visitor came from, never the full address.
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "strict-origin" }] }, ...designHostHeaders()];
  },
  async redirects() {
    return [
      // The kit page moved to the design site, which serves only its own
      // pages (lib/site-hosts.ts). First, so /staff/kit takes one hop.
      ...designRedirects(),
      // The portal's pages move to its own host, and a Referral link opened
      // there goes to the public site (#497, lib/site-hosts.ts). Production
      // hosts only; first, so the rules below then run on the right host.
      ...crossHostRedirects(),
      // Sign-in moved from /login to /auth (#497 slice C), and the Discount
      // code sign-in pages before it (#264, #265). Old links keep working,
      // query and all.
      ...movedSignInRedirects(),
      // The agent dashboard moved from /discount-code/students to /home (#539).
      movedAgentStudentsRedirect(),
      // The per-language copies are reached only through the rewrites below
      // (#286). Opened directly, they send the visitor to the public address,
      // where the cookie picks the copy.
      { source: `${LANGUAGE_STATE_PREFIX}/:state/agents-auth/:path*`, destination: "/auth/:path*", permanent: false },
      { source: `${LANGUAGE_STATE_PREFIX}/:state/:path*`, destination: "/:path*", permanent: false },
      // The staff list of applicants moved from /staff/leads. Bookmarks and
      // links in old messages keep working, query and all.
      { source: "/staff/leads", destination: "/staff/applicants", permanent: true },
      { source: "/staff/leads/:path*", destination: "/staff/applicants/:path*", permanent: true },
      // An invite or reset link on the site root goes on to its page.
      ...rootEmailLinkRedirects(),
      // After those: both app hosts' roots open sign-in.
      ...appRootRedirects(),
    ];
  },
  async rewrites() {
    return {
      // Before the filesystem and dynamic routes: per-host manifest, icons and
      // cached /auth/forgot-password theme for agents. (#539), then the
      // per-language cached copies (lib/language-state.ts, ADR 0006).
      // The design site comes first: its pages for a browser that gave the
      // password, the lock screen at the same address for any other, and
      // design.'s root addresses (lib/site-hosts.ts).
      beforeFiles: [...designRewrites(designGateToken), ...agentsHostRewrites(), ...languageStateRewrites()],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
