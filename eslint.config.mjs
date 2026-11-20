import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Every staff screen is drawn in the new look (#316, #332): no file under
// app/staff/ may import the old parts. The public pages still use some.
const OLD_PARTS = "is an old part: a staff screen uses components/kit and components/icons only (components/kit/README.md).";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/staff/**"],
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
