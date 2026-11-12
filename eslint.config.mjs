import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { newRoutes, ROUTE_LOOKS, routeFiles } from "./scripts/design-lint.mjs";

const root = dirname(fileURLToPath(import.meta.url));

// A converted staff route is drawn whole in the new look (#316): it may not
// import the old parts. Its files are the ones scripts/design-lint.mjs
// treats as the route's, read from app/staff/route-looks.ts, so a route
// marked "new" there is guarded here with no other change. The new shell's
// own folder is held to the same rule.
// ESLint reads `files` as globs, so each route file's path is escaped first:
// unescaped, the brackets of `[id]` or `[...rest]` are a character class and
// the guard would match none of that route's files (#360).
const literal = (path) => path.replace(/[[\]{}()*?!+@]/g, "\\$&");

/** The files the guard covers, for a given app/staff/route-looks.ts source. */
export function convertedFiles(routeLooksSource) {
  return [
    "app/staff/_new-shell/**",
    ...newRoutes(routeLooksSource)
      .flatMap((pattern) => routeFiles(root, pattern).files)
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .map(literal),
  ];
}

const OLD_PARTS = "is an old part: a converted staff screen uses components/kit and components/icons only (components/kit/README.md).";

/** The whole config, guarding the routes a route-looks.ts source marks "new". The tests pass their own. */
export function config(routeLooksSource) {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    {
      files: convertedFiles(routeLooksSource),
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "lucide-react", message: `lucide-react ${OLD_PARTS}` },
              { name: "sonner", message: `sonner's toast ${OLD_PARTS}` },
            ],
            patterns: [
              {
                regex: "(^@/|/)components/staff(/|$)",
                message: `components/staff ${OLD_PARTS}`,
              },
              {
                regex: "(^@/|/)components/ui(/|$)",
                message: `components/ui ${OLD_PARTS}`,
              },
              {
                regex: "(^|/)_shell(/|$)",
                message: `The old shell ${OLD_PARTS}`,
              },
              {
                regex: "(^@/|/)components/status-chip$",
                message: `The old StatusChip ${OLD_PARTS}`,
              },
            ],
          },
        ],
      },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
      // Default ignores of eslint-config-next:
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Agent folders. Worktrees under .claude/ and .worktrees/ are full
      // checkouts, each with its own .next build output.
      ".claude/**",
      ".codex/**",
      ".worktrees/**",
    ]),
  ]);
}

export default config(readFileSync(`${root}/${ROUTE_LOOKS}`, "utf8"));
