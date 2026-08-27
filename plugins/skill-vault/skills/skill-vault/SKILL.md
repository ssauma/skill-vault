---
name: skill-vault
description: Use when the user explicitly asks to diagnose skill context overhead, determine whether a skill should be isolated, apply an approved vault plan, inspect vault status, or roll back Skill Vault changes.
---

# Skill Vault

Use the `skill-vault` CLI as the deterministic engine. Do not recreate its scan or transaction logic manually.

Before any workflow, run `command -v skill-vault`. If it is unavailable, stop and tell the user to install the separate CLI with `npm install --global skill-vault`; plugin installation alone does not install executables. Do not use `npx`, download code implicitly, or substitute manual mutations.

## Diagnose

Run `skill-vault doctor --json`. This is read-only. Explain that Codex initially loads discovery metadata, not every full `SKILL.md` body, and preserve all three outcomes:

- `isolation_recommended`
- `no_action_needed`
- `unsuitable_for_isolation`

Do not recommend isolation solely because a skill body is large.

## Apply

After the user selects a skill, run `skill-vault plan --skill <absolute-SKILL.md-path> --json` and show its exact effects. Run `skill-vault apply <plan-id> --json` only after explicit approval of that plan.

The transaction must preserve the original, add only an owned `skills.config` disable block, and stage an explicit-only proxy with the original skill name. Do not change the user's `$skill-name` or slash-command habits.

## Roll back

Use `skill-vault status --json` before mutation. For complete recovery, run `skill-vault rollback --all --json`. If drift is reported, stop; do not overwrite user edits or restore a whole configuration snapshot.

If the CLI is unavailable, direct the user to `scripts/uninstall.sh` in the repository. It invokes the bundled recovery entrypoint before removing the npm package.

Reply in the user's language unless they request another language.
