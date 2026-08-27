# CLI specification

`skill-vault` is both the npm package name and executable. npm installation never runs lifecycle mutation hooks.

## State and ownership

- State root: `${CODEX_HOME:-$HOME/.codex}/skill-vault`
- Proxy root: the source repository's `.agents/skills` discovery root for repository-scoped skills; otherwise `$HOME/.agents/skills/skill-vault-<name>-<hash>`
- Codex configuration: `${CODEX_HOME:-$HOME/.codex}/config.toml`
- Original skill files are never edited, moved, or deleted.
- Configuration changes are append-only, marker-delimited inverse patches removed by verified truncation.
- Rollback removes only content whose recorded hashes still match.
- Proxy deletion first atomically renames owned content into the non-discovered state quarantine; interrupted deletion resumes before the source is re-enabled.

## Commands

### `skill-vault init [--json]`

Performs the first read-only diagnosis. It creates no state and applies no recommendation.

### `skill-vault doctor [--json] [--root PATH]`

Scans discoverable standalone user and repository skills. It reports discovery characters separately from activation bytes.

- `isolation_recommended`: the description exceeds 500 characters or total discovery metadata exceeds 700 characters.
- `no_action_needed`: progressive disclosure already protects startup context.
- `unsuitable_for_isolation`: invalid, generated, cached, system, or already-managed source.

### `skill-vault plan --skill PATH [--json]`

Records a reviewable plan and source hash. It does not modify Codex configuration or skill discovery.

### `skill-vault apply PLAN_ID [--json]`

Verifies the plan and source hash, appends one owned `[[skills.config]]` disable entry, and creates one explicit-only proxy whose frontmatter `name` equals the original name. Existing config entries and proxy collisions stop the operation.

### `skill-vault status [--json]`

Reports saved plans, active transactions, owned paths, and the state root.

### `skill-vault load --id TRANSACTION_ID [--json]`

Loads the current canonical source for an approved proxy. Relative resources remain anchored at the reported source root.

### `skill-vault rollback --all [--json]`

Verifies owned hashes, quarantines and removes each exact proxy, then removes its inverse config patch. This ordering prevents the proxy and source from being active together. Drift stops rollback without overwriting changes, and an interrupted quarantine deletion resumes on the next mutating command.

### `skill-vault uninstall [--purge] [--json]`

Runs and verifies full rollback. Recovery state is retained unless `--purge` is explicit.

## Exit behavior

- `0`: requested operation completed.
- nonzero: no success should be inferred; JSON mode returns `{ "ok": false, "error": "..." }`.
- Mutating commands report that Codex must restart before discovery changes take effect.

## Host scope

The diagnosis is useful on any host that stores Agent Skills. Reversible `apply` in v0.1 targets Codex's documented `[[skills.config]]` mechanism. Claude Code installation exposes the doctor workflow but does not claim equivalent mutation support.
