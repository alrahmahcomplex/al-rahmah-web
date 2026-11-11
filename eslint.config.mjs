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
const convertedFiles = [
  "app/staff/_new-shell/**",
  ...newRoutes(readFileSync(`${root}/${ROUTE_LOOKS}`, "utf8")).flatMap((pattern) => routeFiles(root, pattern).files),
].filter((file) => file.endsWith("/**") || /\.(tsx?|jsx?)$/.test(file));

const OLD_PARTS = "is an old part: a converted staff screen uses components/kit and components/icons only (components/kit/README.md).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: convertedFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "lucide-react", message: `lucide-react ${OLD_PARTS}` },
            { name: "@/components/status-chip", message: `The old StatusChip ${OLD_PARTS}` },
            { name: "sonner", message: `sonner's toast ${OLD_PARTS}` },
          ],
          patterns: [
            { group: ["@/components/staff", "@/components/staff/*"], message: `components/staff ${OLD_PARTS}` },
            { group: ["@/components/ui", "@/components/ui/*"], message: `components/ui ${OLD_PARTS}` },
            { group: ["**/_shell", "**/_shell/*", "@/app/staff/_shell/*"], message: `The old shell ${OLD_PARTS}` },
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

export default eslintConfig;
