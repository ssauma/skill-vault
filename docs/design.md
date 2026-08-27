# Design boundaries

## What consumes startup context

Codex initially exposes each eligible skill's name, description, and path within a bounded catalog. The full `SKILL.md` body is loaded only when the skill activates. Skill Vault therefore treats discovery metadata and activation content as separate costs.

## Loading tiers

1. The `skill-vault` management skill is explicit-only.
2. An approved proxy is explicit-only and keeps the original frontmatter name.
3. The canonical skill content remains at its original path and is loaded on demand through `skill-vault load`.

This reduces discovery metadata only for an approved target. It does not claim that wrapping a large body makes activation itself cheaper.

## No ambient work

Skill Vault installs no session-start hook, prompt hook, watcher, daemon, or background process. Plugin-install detection is not automatic because the supported hooks do not provide a zero-cost plugin-installed event. A later explicit doctor run can inspect new plugin cache entries without modifying them.

## Asynchronous context

Host-isolated or subagent execution may be added only where the host exposes a stable capability and representative evaluations show that target-skill behavior is preserved. v0.1 performs deterministic on-demand loading and does not pretend that asynchronous isolation is portable across hosts.

## Mutation boundary

v0.1 applies isolation only to standalone Codex skills using the documented `[[skills.config]]` disable mechanism. Generated plugin caches, system skills, existing config entries, ambiguous identities, and drifted owned files are hard stops.

Apply and rollback are journaled under `${CODEX_HOME:-$HOME/.codex}/skill-vault`. Rollback atomically moves the exact owned proxy into a non-discovered quarantine before re-enabling the canonical source. If deletion is interrupted, the next mutating command validates and resumes that quarantine cleanup; it never restores an entire configuration snapshot.
