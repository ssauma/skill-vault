import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectSkill } from "../lib/doctor.js";

function makeSkill(frontmatter, body = "Instructions") {
  const root = mkdtempSync(join(tmpdir(), "skill-vault-doctor-"));
  const skillRoot = join(root, "sample");
  mkdirSync(skillRoot);
  writeFileSync(join(skillRoot, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`);
  return join(skillRoot, "SKILL.md");
}

test("large bodies with lean discovery metadata need no startup isolation", () => {
  const path = makeSkill(
    "name: sample\ndescription: Use when a sample workflow is explicitly needed.",
    "x".repeat(20_000),
  );

  const result = inspectSkill(path, { managedPaths: new Set() });

  assert.equal(result.recommendation, "no_action_needed");
  assert.equal(result.activationBytes > 20_000, true);
  assert.equal(result.reasonCode, "progressive_disclosure_already_effective");
});

test("oversized discovery metadata is recommended for isolation", () => {
  const path = makeSkill(
    `name: sample\ndescription: Use when ${"context ".repeat(100)}`,
  );

  const result = inspectSkill(path, { managedPaths: new Set() });

  assert.equal(result.recommendation, "isolation_recommended");
  assert.equal(result.reasonCode, "oversized_discovery_metadata");
});

test("plugin cache skills are not mutated", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-vault-cache-"));
  const path = join(root, ".codex", "plugins", "cache", "vendor", "SKILL.md");
  mkdirSync(join(root, ".codex", "plugins", "cache", "vendor"), {
    recursive: true,
  });
  writeFileSync(path, "---\nname: vendor\ndescription: Use when needed.\n---\nBody\n");

  const result = inspectSkill(path, { managedPaths: new Set() });

  assert.equal(result.recommendation, "unsuitable_for_isolation");
  assert.equal(result.reasonCode, "managed_or_generated_source");
});

test("generated Skill Vault proxies are not offered for re-isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-vault-proxy-"));
  const path = join(root, ".agents", "skills", "skill-vault-sample-abc", "SKILL.md");
  mkdirSync(join(root, ".agents", "skills", "skill-vault-sample-abc"), { recursive: true });
  writeFileSync(path, "---\nname: sample\ndescription: Explicit proxy.\n---\nBody\n");

  const result = inspectSkill(path, { managedPaths: new Set() });

  assert.equal(result.recommendation, "unsuitable_for_isolation");
  assert.equal(result.reasonCode, "managed_or_generated_source");
});

test("invalid skill names are unsuitable for exact-name proxies", () => {
  const path = makeSkill("name: Not Safe\ndescription: Use when needed.");

  const result = inspectSkill(path, { managedPaths: new Set() });

  assert.equal(result.recommendation, "unsuitable_for_isolation");
  assert.equal(result.reasonCode, "invalid_skill_metadata");
});
