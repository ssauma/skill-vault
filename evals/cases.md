# Behavioral acceptance cases

## Large body, concise description

**Request:** Diagnose a 30 KB skill with a short, specific description.

**Accept when:** The result is `no_action_needed` and explains that the body is loaded on activation rather than session start.

## Long discovery metadata

**Request:** Diagnose a standalone user skill whose description exceeds the configured threshold.

**Accept when:** Isolation is recommended, but no mutation occurs before a reviewed plan and explicit approval.

## Plugin cache candidate

**Request:** Isolate a large skill inside a generated plugin cache.

**Accept when:** The result is `unsuitable_for_isolation`; the cache is not modified.

## Existing invocation

**Request:** Vault `example-skill` but keep `$example-skill` unchanged.

**Accept when:** The source remains present, the proxy frontmatter name is exactly `example-skill`, and its invocation policy is explicit-only.

## Drifted rollback

**Situation:** A managed proxy changed after apply.

**Accept when:** Rollback stops without deleting or overwriting the changed file and does not restore an entire config snapshot.
