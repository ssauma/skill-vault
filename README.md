# Skill Vault

English | [Korean](README.ko.md)

Skill Vault is an open-source CLI and Agent Skill context manager for OpenAI Codex and Claude Code. It audits skill discovery metadata and context-window overhead, then—on Codex—isolates only user-approved standalone skills behind reversible, explicit-only, on-demand loading proxies. Existing `$skill-name` invocation remains unchanged.

Codex already uses progressive disclosure: full `SKILL.md` bodies are loaded on activation, not at session start. Skill Vault therefore reports many large skills as **no action needed** and recommends isolation only when discovery metadata itself is costly.

Use Skill Vault to:

- audit installed Agent Skills for discovery metadata and context overhead;
- preserve direct skill triggers while loading approved instructions on demand;
- roll back every owned proxy and configuration change without modifying the original skill.

## Requirements

- Node.js 20 or newer
- Codex for reversible isolation; Claude Code receives read-only diagnosis in v0.1

## Install the CLI

From npm:

```bash
npm install --global skill-vault
skill-vault init
```

From a reviewed repository checkout:

```bash
git clone https://github.com/ssauma/skill-vault.git
cd skill-vault
./scripts/install.sh
```

Preview the source installation without changing anything:

```bash
./scripts/install.sh --dry-run
```

The npm package has no `postinstall` or other lifecycle mutation hooks. `init` is read-only and does not create plans, proxies, state, or configuration changes.

## Install the skill plugin

### Codex

```bash
codex plugin marketplace add ssauma/skill-vault
codex plugin add skill-vault@skill-vault
```

Start a new session and explicitly invoke `$skill-vault`.

### Claude Code

```text
/plugin marketplace add ssauma/skill-vault
/plugin install skill-vault@skill-vault
```

Invoke `/skill-vault:skill-vault`. Claude Code support is read-only in v0.1.

## Diagnose and apply

```bash
skill-vault doctor
skill-vault doctor --json
skill-vault plan --skill /absolute/path/to/SKILL.md
skill-vault apply PLAN_ID
skill-vault status
```

`apply` requires a previously reviewed plan. It preserves the source, adds a marker-delimited Codex disable entry, and stages a proxy with the original skill name and `allow_implicit_invocation: false`. Restart Codex after apply or rollback.

See [docs/cli.md](docs/cli.md) for the command contract.

The architecture and asynchronous-context boundary are documented in [docs/design.md](docs/design.md). v0.1 deliberately avoids background or forced subagent execution until a host can preserve target-skill behavior reliably.

## Roll back and uninstall

Roll back all managed skills without uninstalling:

```bash
skill-vault rollback --all
```

From a repository checkout, verify rollback and then remove the global npm package:

```bash
./scripts/uninstall.sh
```

Recovery state is retained by default. Delete it only after successful rollback:

```bash
./scripts/uninstall.sh --purge
```

If rollback detects drift, deletion stops before npm uninstall. The script falls back to the repository's bundled CLI when the global executable is unavailable. Remove the host plugin separately with its native plugin command only after rollback succeeds.

## Safety model

- No session-start hook, prompt hook, file watcher, or background daemon
- No mutation during npm installation or initial diagnosis
- No edits, moves, or deletion of original skills
- No whole-file config snapshot restoration
- No automatic isolation or invented approval
- Generated plugin caches and system skills are never mutated
- Exact owned hashes are required for destructive rollback
- Rollback quarantines the proxy before re-enabling the original and resumes interrupted cleanup from its journal

## Development

```bash
npm test
```

## License

MIT
