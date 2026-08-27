import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyPlan,
  createPlan,
  rollbackAll,
  readState,
} from "../lib/vault.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skill-vault-transaction-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const skillRoot = join(root, "source", "large-skill");
  mkdirSync(skillRoot, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(skillRoot, "SKILL.md"),
    "---\nname: large-skill\ndescription: Use when large work is needed.\n---\nCanonical instructions.\n",
  );
  writeFileSync(join(codexHome, "config.toml"), "model = \"gpt-5\"\n");
  return { root, codexHome, agentsHome, skillPath: join(skillRoot, "SKILL.md") };
}

test("apply disables the original and stages an explicit exact-name proxy", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);

  applyPlan(plan.id, paths);

  const state = readState(paths);
  const record = state.transactions[0];
  const config = readFileSync(join(paths.codexHome, "config.toml"), "utf8");
  const proxy = readFileSync(record.proxySkillPath, "utf8");
  const policy = readFileSync(record.proxyPolicyPath, "utf8");

  assert.match(config, /enabled = false/);
  assert.match(proxy, /name: large-skill/);
  assert.match(proxy, /skill-vault load/);
  assert.match(policy, /allow_implicit_invocation: false/);
  assert.equal(existsSync(paths.skillPath), true);
});

test("rollback removes only owned changes and preserves unrelated config", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);

  rollbackAll(paths);

  assert.equal(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), "model = \"gpt-5\"\n");
  assert.deepEqual(readState(paths).transactions, []);
  assert.equal(existsSync(paths.skillPath), true);
});

test("rollback removes multiple stacked config transactions in reverse order", () => {
  const paths = fixture();
  const secondRoot = join(paths.root, "source", "second-skill");
  mkdirSync(secondRoot, { recursive: true });
  const secondPath = join(secondRoot, "SKILL.md");
  writeFileSync(
    secondPath,
    "---\nname: second-skill\ndescription: Use when a second large task is needed.\n---\nCanonical instructions.\n",
  );
  const firstPlan = createPlan(paths.skillPath, paths);
  applyPlan(firstPlan.id, paths);
  const secondPlan = createPlan(secondPath, paths);
  applyPlan(secondPlan.id, paths);

  const result = rollbackAll(paths);

  assert.equal(result.rolledBack, 2);
  assert.equal(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), "model = \"gpt-5\"\n");
  assert.deepEqual(readState(paths).transactions, []);
});

test("a single-quoted existing skills.config path blocks apply", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  writeFileSync(
    join(paths.codexHome, "config.toml"),
    `model = "gpt-5"\n\n[[skills.config]]\npath = '${paths.skillPath}' # existing owner\nenabled = true\n`,
  );

  assert.throws(() => applyPlan(plan.id, paths), /already controls this skill/i);
  assert.deepEqual(readState(paths).transactions, []);
});

test("rollback stops when an owned proxy has drifted", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const record = readState(paths).transactions[0];
  writeFileSync(record.proxySkillPath, "user edit\n");

  assert.throws(() => rollbackAll(paths), /drift/i);
  assert.equal(existsSync(record.proxySkillPath), true);
});

test("rollback stops before mutation when an unexpected proxy file exists", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const record = readState(paths).transactions[0];
  writeFileSync(join(record.proxyDir, "user-note.md"), "keep me\n");

  assert.throws(() => rollbackAll(paths), /unexpected proxy content/i);
  assert.equal(existsSync(record.proxySkillPath), true);
  assert.match(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), /enabled = false/);
});

test("a live transaction lock prevents concurrent state mutation", () => {
  const paths = fixture();
  const lockRoot = join(paths.codexHome, "skill-vault.mutation.lock");
  mkdirSync(lockRoot, { recursive: true });
  writeFileSync(join(lockRoot, "owner"), `${process.pid}\n`);

  assert.throws(() => createPlan(paths.skillPath, paths), /another skill-vault mutation/i);
});

test("a stale transaction lock is recovered without touching external paths", () => {
  const paths = fixture();
  const lockRoot = join(paths.codexHome, "skill-vault.mutation.lock");
  mkdirSync(lockRoot, { recursive: true });
  writeFileSync(join(lockRoot, "owner"), "2147483647\n");

  const plan = createPlan(paths.skillPath, paths);

  assert.match(plan.id, /^plan-/);
  assert.equal(existsSync(lockRoot), false);
});

test("duplicate active skill names block a plan", () => {
  const paths = fixture();
  const duplicateRoot = join(paths.root, "duplicate");
  mkdirSync(duplicateRoot, { recursive: true });
  writeFileSync(
    join(duplicateRoot, "SKILL.md"),
    "---\nname: large-skill\ndescription: Use when duplicate work is needed.\n---\nOther.\n",
  );

  assert.throws(
    () => createPlan(paths.skillPath, { ...paths, scanRoots: [join(paths.root, "source"), duplicateRoot] }),
    /duplicate skill name/i,
  );
});

test("a duplicate name introduced after planning blocks apply", () => {
  const paths = fixture();
  const scanRoot = join(paths.root, "source");
  const plan = createPlan(paths.skillPath, { ...paths, scanRoots: [scanRoot] });
  const duplicateRoot = join(scanRoot, "new-duplicate");
  mkdirSync(duplicateRoot, { recursive: true });
  writeFileSync(
    join(duplicateRoot, "SKILL.md"),
    "---\nname: large-skill\ndescription: Use when duplicate work is needed.\n---\nOther.\n",
  );

  assert.throws(() => applyPlan(plan.id, paths), /duplicate skill name/i);
  assert.doesNotMatch(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), /enabled = false/);
});

test("pending recovery validates proxies before removing config", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const statePath = join(paths.codexHome, "skill-vault", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.transactions[0].status = "applying";
  state.transactions[0].phase = "config_appended";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(join(state.transactions[0].proxyDir, "user-note.md"), "keep me\n");

  assert.throws(() => createPlan(paths.skillPath, paths), /unexpected proxy content/i);
  assert.match(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), /enabled = false/);
});

test("partial config append is recovered from journal metadata", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const statePath = join(paths.codexHome, "skill-vault", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const record = state.transactions[0];
  state.transactions[0].status = "applying";
  state.transactions[0].phase = "staged";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(record.proxyDir, record.stagingDir);
  const config = readFileSync(record.configPath, "utf8");
  writeFileSync(record.configPath, config.slice(0, -8));

  const recoveredPlan = createPlan(paths.skillPath, paths);
  assert.match(recoveredPlan.id, /^plan-/);
  assert.equal(readFileSync(record.configPath, "utf8"), "model = \"gpt-5\"\n");
});

test("rollback resumes after config removal without leaving the source disabled", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const statePath = join(paths.codexHome, "skill-vault", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const record = state.transactions[0];
  writeFileSync(record.configPath, "model = \"gpt-5\"\n");
  state.transactions[0].status = "rolling_back";
  state.transactions[0].phase = "config_removed";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = rollbackAll(paths);

  assert.equal(result.rolledBack, 0);
  assert.equal(existsSync(record.proxyDir), false);
  assert.deepEqual(readState(paths).transactions, []);
  assert.equal(readFileSync(record.configPath, "utf8"), "model = \"gpt-5\"\n");
});

test("rollback recovers a partially deleted quarantined proxy before enabling the source", () => {
  const paths = fixture();
  const plan = createPlan(paths.skillPath, paths);
  applyPlan(plan.id, paths);
  const statePath = join(paths.codexHome, "skill-vault", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const record = state.transactions[0];
  state.transactions[0].status = "rolling_back";
  state.transactions[0].phase = "preflighted";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  mkdirSync(join(paths.codexHome, "skill-vault", "quarantine"), { recursive: true });
  renameSync(record.proxyDir, record.quarantineDir);
  rmSync(join(record.quarantineDir, "SKILL.md"));

  const result = rollbackAll(paths);

  assert.equal(result.rolledBack, 0);
  assert.equal(existsSync(record.quarantineDir), false);
  assert.deepEqual(readState(paths).transactions, []);
  assert.equal(readFileSync(record.configPath, "utf8"), "model = \"gpt-5\"\n");
});

test("repository-scoped skills keep their proxy in the same discovery scope", () => {
  const paths = fixture();
  const repoSkillRoot = join(paths.root, "repo", ".agents", "skills", "repo-skill");
  mkdirSync(repoSkillRoot, { recursive: true });
  const repoSkillPath = join(repoSkillRoot, "SKILL.md");
  writeFileSync(
    repoSkillPath,
    "---\nname: repo-skill\ndescription: Use when repository work is needed.\n---\nBody.\n",
  );
  const discoveryRoot = join(paths.root, "repo", ".agents", "skills");
  const plan = createPlan(repoSkillPath, { ...paths, scanRoots: [discoveryRoot] });

  const record = applyPlan(plan.id, paths);

  assert.equal(record.proxyDir.startsWith(`${discoveryRoot}/skill-vault-repo-skill-`), true);
});
