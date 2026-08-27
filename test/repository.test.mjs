import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));

test("package has no npm lifecycle mutation hooks", () => {
  const pkg = json("package.json");

  assert.equal(pkg.name, "skill-vault");
  assert.equal(pkg.bin["skill-vault"], "./bin/skill-vault.js");
  for (const hook of ["preinstall", "install", "postinstall", "preuninstall", "postuninstall"]) {
    assert.equal(pkg.scripts?.[hook], undefined);
  }
});

test("ships dual-host manifests and explicit-only skill policy", () => {
  const required = [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "plugins/skill-vault/.codex-plugin/plugin.json",
    "plugins/skill-vault/.claude-plugin/plugin.json",
    "plugins/skill-vault/skills/skill-vault/SKILL.md",
    "plugins/skill-vault/skills/skill-vault/agents/openai.yaml",
  ];
  for (const path of required) assert.equal(existsSync(path), true, `missing ${path}`);

  assert.match(
    read("plugins/skill-vault/skills/skill-vault/agents/openai.yaml"),
    /allow_implicit_invocation: false/,
  );
  assert.match(read("plugins/skill-vault/skills/skill-vault/SKILL.md"), /command -v skill-vault/);
  assert.match(read("README.md"), /npm install --global skill-vault/);
});

test("ships repository-specific community health files", () => {
  for (const path of [
    "README.md",
    "README.ko.md",
    "LICENSE",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "SUPPORT.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ]) {
    assert.equal(existsSync(path), true, `missing ${path}`);
  }
});
