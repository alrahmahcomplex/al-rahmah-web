# Changelog files

An app PR's changelog entry goes in a file of its own here, never in `CHANGELOG.md`. Two PRs then never edit the same file, and a green PR can merge without a rebase for the changelog.

Name the file after your branch, without the `claude/` or `codex/` part: `changes/sibling-discount-screen.md`. It holds the bump and the entry:

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

After the merge, the Release workflow moves every file here into a dated, versioned entry at the top of `CHANGELOG.md`, deletes the files, and tags the release. Internal maintenance adds no file. [Releasing](../docs/agents/releasing.md) has the whole procedure.
