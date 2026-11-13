# Changelog files

An app PR's changelog entry goes in a file of its own here, never in `CHANGELOG.md`. Two PRs then never edit the same file, and a green PR can merge without a rebase for the changelog.

Name the file after your branch, without the `claude/` or `codex/` part and with any other `/` turned into `-`: `changes/sibling-discount-screen.md`. No folders; lower-case letters, digits, `.`, `_` and `-` only. It holds the bump and the entry:

```markdown
---
bump: minor
---

### NEW

- What someone using the app can now do, in their words.
```

- `bump` is `patch` for a correction to shipped behaviour or looks, `minor` for a new capability. A major release is prepared by hand.
- Sections are `### NEW`, `### IMPROVED` and `### FIXED`; use only those with content. Each needs at least one `- ` bullet.
- Write for someone using the app and apply `unslop`.

Once merged, a file here is never edited, renamed or deleted, and CI refuses a PR that does it. The release takes a file when it is added, so an edit to a merged one would never go out.

- To correct an entry that merged, add a new file with the correction.
- If a file with your branch's name is already here, add a new one: `changes/sibling-discount-screen-2.md`.
- A PR that reverts a merge keeps that merge's file and adds its own, saying what was taken back.

After the merge, the Release workflow tags the merge commit with the next version and publishes every file added here since the last release as that version's GitHub Release. The files stay here. Internal maintenance adds no file. [Releasing](../docs/agents/releasing.md) has the whole procedure.
