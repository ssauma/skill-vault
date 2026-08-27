import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { defaultSkillRoots, inspectSkill, scanSkills } from "./doctor.js";
import { parseFrontmatter } from "./frontmatter.js";

const STATE_VERSION = 1;

export function resolvePaths(options = {}) {
  const userHome = options.home ?? homedir();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(userHome, ".codex");
  const agentsHome = options.agentsHome ?? join(userHome, ".agents");
  const requestedConfigPath = options.configPath ?? join(codexHome, "config.toml");
  return {
    codexHome,
    agentsHome,
    stateRoot: options.stateRoot ?? join(codexHome, "skill-vault"),
    configPath: existsSync(requestedConfigPath) ? realpathSync(requestedConfigPath) : requestedConfigPath,
  };
}

export function readState(options = {}) {
  const { stateRoot } = resolvePaths(options);
  const path = join(stateRoot, "state.json");
  if (!existsSync(path)) return emptyState();
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (state.schemaVersion !== STATE_VERSION) throw new Error("Unsupported skill-vault state version.");
  return state;
}

export function createPlan(skillPath, options = {}) {
  const paths = resolvePaths(options);
  return withMutationLock(paths, () => createPlanUnlocked(skillPath, options, paths));
}

function createPlanUnlocked(skillPath, options, paths) {
  recoverTransactions(paths);
  const state = readState(paths);
  const managedPaths = new Set(state.transactions.map((item) => item.sourceSkillPath));
  const diagnosis = inspectSkill(skillPath, { managedPaths });
  if (diagnosis.recommendation === "unsuitable_for_isolation") {
    throw new Error(`Skill cannot be isolated: ${diagnosis.reasonCode}`);
  }
  const absolutePath = diagnosis.path;
  const identityScanRoots = options.scanRoots ?? defaultSkillRoots({
    home: options.home ?? dirname(paths.agentsHome),
    codexHome: paths.codexHome,
    cwd: options.cwd ?? options.root ?? process.cwd(),
  });
  const conflicts = nameConflicts(diagnosis.name, absolutePath, identityScanRoots, managedPaths);
  if (conflicts.length) {
    throw new Error(`Duplicate skill name detected for ${diagnosis.name}; resolve collisions before isolation.`);
  }
  const content = readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatter(content);
  const id = `plan-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const proxyRoot = proxyRootFor(absolutePath, paths);
  const plan = {
    id,
    createdAt: new Date().toISOString(),
    name: parsed.metadata.name,
    sourceSkillPath: absolutePath,
    sourceHash: hash(content),
    identityScanRoots,
    proxyRoot,
    diagnosis,
    changes: [
      { type: "append_disable_entry", path: paths.configPath },
      { type: "create_explicit_proxy", root: proxyRoot },
    ],
  };
  state.plans.push(plan);
  writeState(state, paths);
  return plan;
}

export function applyPlan(planId, options = {}) {
  const paths = resolvePaths(options);
  return withMutationLock(paths, () => applyPlanUnlocked(planId, paths));
}

function applyPlanUnlocked(planId, paths) {
  recoverTransactions(paths);
  const state = readState(paths);
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  if (state.transactions.some((item) => item.sourceSkillPath === plan.sourceSkillPath)) {
    throw new Error("Skill is already managed.");
  }
  const source = readFileSync(plan.sourceSkillPath, "utf8");
  if (hash(source) !== plan.sourceHash) throw new Error("Source skill drifted after planning; create a new plan.");
  const managedPaths = new Set(state.transactions.map((item) => item.sourceSkillPath));
  const conflicts = nameConflicts(
    plan.name,
    plan.sourceSkillPath,
    plan.identityScanRoots ?? defaultSkillRoots({
      home: dirname(paths.agentsHome),
      codexHome: paths.codexHome,
      cwd: process.cwd(),
    }),
    managedPaths,
  );
  if (conflicts.length) {
    throw new Error(`Duplicate skill name detected for ${plan.name}; create a new plan after resolving collisions.`);
  }

  const configBefore = existsSync(paths.configPath) ? readFileSync(paths.configPath, "utf8") : "";
  const existingControl = skillConfigControl(configBefore, plan.sourceSkillPath);
  if (existingControl === "controls_source") {
    throw new Error("An existing skills.config entry already controls this skill; refusing to override it.");
  }
  if (existingControl === "unverifiable") {
    throw new Error("An existing skills.config path could not be verified safely; refusing to modify config.");
  }

  const transactionId = `txn-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const suffix = hash(plan.sourceSkillPath).slice(0, 10);
  const proxyRoot = plan.proxyRoot ?? proxyRootFor(plan.sourceSkillPath, paths);
  const proxyDir = join(proxyRoot, `skill-vault-${slug(plan.name)}-${suffix}`);
  if (existsSync(proxyDir)) throw new Error(`Proxy path already exists: ${proxyDir}`);
  const stagingDir = join(paths.stateRoot, "staging", transactionId);
  const quarantineDir = join(paths.stateRoot, "quarantine", transactionId);
  const stagedSkillPath = join(stagingDir, "SKILL.md");
  const stagedPolicyPath = join(stagingDir, "agents", "openai.yaml");
  mkdirSync(dirname(stagedPolicyPath), { recursive: true });

  const proxy = proxyContent(plan.name, transactionId);
  const policy = proxyPolicy(plan.name);
  writeFileSync(stagedSkillPath, proxy, { mode: 0o600 });
  writeFileSync(stagedPolicyPath, policy, { mode: 0o600 });

  const configBlock = normalizeAppend(configBefore, disableBlock(transactionId, plan.sourceSkillPath));
  const record = {
    id: transactionId,
    planId,
    status: "applying",
    phase: "staged",
    appliedAt: new Date().toISOString(),
    name: plan.name,
    sourceSkillPath: plan.sourceSkillPath,
    proxyDir,
    proxyRoot,
    proxySkillPath: join(proxyDir, "SKILL.md"),
    proxyPolicyPath: join(proxyDir, "agents", "openai.yaml"),
    proxySkillHash: hash(proxy),
    proxyPolicyHash: hash(policy),
    stagingDir,
    quarantineDir,
    configPath: paths.configPath,
    configBlock,
    configExisted: existsSync(paths.configPath),
    configBeforeSize: Buffer.byteLength(configBefore),
    configBeforeHash: hash(configBefore),
  };
  state.transactions.push(record);
  writeState(state, paths);

  try {
    appendOwnedConfigBlock(record);
    record.phase = "config_appended";
    writeState(state, paths);
    mkdirSync(dirname(proxyDir), { recursive: true });
    renameSync(stagingDir, proxyDir);
    record.phase = "active";
    record.status = "active";
    writeState(state, paths);
    return record;
  } catch (error) {
    recoverTransactions(paths);
    throw error;
  }
}

export function rollbackAll(options = {}) {
  const paths = resolvePaths(options);
  return withMutationLock(paths, () => rollbackAllUnlocked(paths));
}

function rollbackAllUnlocked(paths) {
  recoverTransactions(paths);
  const state = readState(paths);
  const active = state.transactions.filter((item) => item.status === "active");
  for (const record of active) preflightRollback(record, paths);
  preflightConfigRollbackChain(active);
  for (const record of [...active].reverse()) rollbackRecord(record, state, paths);
  writeState(state, paths);
  return { rolledBack: active.length };
}

export function loadSkill(identifier, options = {}) {
  const paths = resolvePaths(options);
  const state = readState(paths);
  const matches = state.transactions.filter(
    (item) => item.status === "active" && (item.id === identifier || item.name === identifier),
  );
  if (matches.length !== 1) throw new Error(matches.length ? "Skill name is ambiguous; use transaction id." : `Managed skill not found: ${identifier}`);
  const record = matches[0];
  return {
    id: record.id,
    name: record.name,
    sourceSkillPath: record.sourceSkillPath,
    sourceRoot: dirname(record.sourceSkillPath),
    content: readFileSync(record.sourceSkillPath, "utf8"),
  };
}

export function purgeState(options = {}) {
  const paths = resolvePaths(options);
  return withMutationLock(paths, () => purgeStateUnlocked(paths));
}

function purgeStateUnlocked(paths) {
  const state = readState(paths);
  if (state.transactions.length) throw new Error("Cannot purge state while managed transactions remain.");
  const expected = join(paths.codexHome, "skill-vault");
  if (resolve(paths.stateRoot) !== resolve(expected)) {
    throw new Error(`Refusing to purge unexpected state root: ${paths.stateRoot}`);
  }
  if (existsSync(paths.stateRoot)) rmSync(paths.stateRoot, { recursive: true });
}

function recoverTransactions(paths) {
  const state = readState(paths);
  const applying = state.transactions.filter((item) => item.status === "applying");
  const rollingBack = state.transactions.filter((item) => item.status === "rolling_back");
  if (!applying.length && !rollingBack.length) return;
  for (const record of applying) preflightApplying(record, paths);
  for (const record of rollingBack) preflightRollingBack(record, paths);
  for (const record of applying) {
    removeOwnedProxy(record.stagingDir, record, true, paths);
    removeOwnedProxy(record.proxyDir, record, false, paths);
    removeOwnedConfigAppend(record);
    state.transactions = state.transactions.filter((item) => item.id !== record.id);
    cleanupCreatedConfig(record);
    writeState(state, paths);
  }
  for (const record of rollingBack) resumeRollback(record, state, paths);
}

function preflightApplying(record, paths) {
  const state = ownedConfigState(record);
  if (!new Set(["before", "partial", "appended"]).has(state)) {
    throw new Error(`Config drift detected for ${record.id}; pending recovery stopped.`);
  }
  const quarantineDir = quarantinePath(record, paths);
  const ownedLocations = [record.stagingDir, record.proxyDir, quarantineDir].filter(
    (path) => path && existsSync(path),
  );
  if (ownedLocations.length > 1) {
    throw new Error(`Owned transaction layout drift detected for ${record.id}; pending recovery stopped.`);
  }
  if (record.stagingDir && existsSync(record.stagingDir)) {
    assertRemovablePath(record.stagingDir, paths, record, true);
    assertOwnedProxyTree(record.stagingDir, record, true);
  }
  if (record.proxyDir && existsSync(record.proxyDir)) {
    assertRemovablePath(record.proxyDir, paths, record, false);
    assertOwnedProxyTree(record.proxyDir, record, false);
  }
  if (existsSync(quarantineDir)) {
    assertQuarantinePath(quarantineDir, record, paths);
    assertOwnedQuarantineTree(quarantineDir, record);
  }
}

function rollbackRecord(record, state, paths) {
  record.status = "rolling_back";
  record.phase = "preflighted";
  writeState(state, paths);
  removeOwnedProxy(record.proxyDir, record, false, paths);
  record.phase = "proxy_removed";
  writeState(state, paths);
  removeOwnedConfigAppend(record);
  record.phase = "config_removed";
  writeState(state, paths);
  state.transactions = state.transactions.filter((item) => item.id !== record.id);
  cleanupCreatedConfig(record);
  writeState(state, paths);
}

function preflightRollback(record, paths) {
  const quarantineDir = quarantinePath(record, paths);
  if (existsSync(quarantineDir)) {
    throw new Error(`Unexpected rollback quarantine for active transaction ${record.id}; rollback stopped.`);
  }
  assertOwnedFile(record.proxySkillPath, record.proxySkillHash);
  assertOwnedFile(record.proxyPolicyPath, record.proxyPolicyHash);
  assertRemovablePath(record.proxyDir, paths, record, false);
  assertOwnedProxyTree(record.proxyDir, record, false);
}

function preflightConfigRollbackChain(records) {
  if (!records.length) return;
  const configPath = records[0].configPath;
  if (records.some((record) => record.configPath !== configPath) || !existsSync(configPath)) {
    throw new Error("Config transaction chain drift detected; rollback stopped.");
  }
  let content = readFileSync(configPath);
  for (const record of [...records].reverse()) {
    if (ownedConfigStateFromContent(record, content) !== "appended") {
      throw new Error(`Config drift detected for ${record.id}; rollback stopped.`);
    }
    content = content.subarray(0, record.configBeforeSize);
  }
}

function preflightRollingBack(record, paths) {
  const state = ownedConfigState(record);
  if (state !== "appended" && state !== "before") {
    throw new Error(`Config drift detected for ${record.id}; rollback recovery stopped.`);
  }
  const quarantineDir = quarantinePath(record, paths);
  const ownedLocations = [record.proxyDir, quarantineDir].filter((path) => path && existsSync(path));
  if (ownedLocations.length > 1) {
    throw new Error(`Owned transaction layout drift detected for ${record.id}; rollback recovery stopped.`);
  }
  if (existsSync(record.proxyDir)) {
    assertRemovablePath(record.proxyDir, paths, record, false);
    assertOwnedProxyTree(record.proxyDir, record, false);
  }
  if (existsSync(quarantineDir)) {
    assertQuarantinePath(quarantineDir, record, paths);
    assertOwnedQuarantineTree(quarantineDir, record);
  }
}

function resumeRollback(record, state, paths) {
  removeOwnedProxy(record.proxyDir, record, false, paths);
  record.phase = "proxy_removed";
  writeState(state, paths);
  if (ownedConfigState(record) === "appended") removeOwnedConfigAppend(record);
  record.phase = "config_removed";
  writeState(state, paths);
  state.transactions = state.transactions.filter((item) => item.id !== record.id);
  cleanupCreatedConfig(record);
  writeState(state, paths);
}

function appendOwnedConfigBlock(record) {
  if (ownedConfigState(record) !== "before") {
    throw new Error(`Config drift detected for ${record.id}; apply stopped.`);
  }
  mkdirSync(dirname(record.configPath), { recursive: true });
  const descriptor = openSync(record.configPath, "a", 0o600);
  try {
    const bytes = Buffer.from(record.configBlock, "utf8");
    const written = writeSync(descriptor, bytes, 0, bytes.length);
    if (written !== bytes.length) throw new Error("Partial config append detected.");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function removeOwnedConfigAppend(record) {
  const state = ownedConfigState(record);
  if (state === "before") return;
  if (state !== "partial" && state !== "appended") {
    throw new Error(`Config drift detected for ${record.id}; inverse patch stopped.`);
  }
  const descriptor = openSync(record.configPath, "r+");
  try {
    ftruncateSync(descriptor, record.configBeforeSize);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function ownedConfigState(record) {
  if (!existsSync(record.configPath)) {
    return !record.configExisted && record.configBeforeSize === 0 ? "before" : "drift";
  }
  return ownedConfigStateFromContent(record, readFileSync(record.configPath));
}

function ownedConfigStateFromContent(record, content) {
  if (content.length === record.configBeforeSize && hash(content) === record.configBeforeHash) {
    return "before";
  }
  if (content.length < record.configBeforeSize) return "drift";
  const prefix = content.subarray(0, record.configBeforeSize);
  if (hash(prefix) !== record.configBeforeHash) return "drift";
  const tail = content.subarray(record.configBeforeSize);
  const block = Buffer.from(record.configBlock, "utf8");
  if (tail.equals(block)) return "appended";
  if (tail.length < block.length && block.subarray(0, tail.length).equals(tail)) return "partial";
  return "drift";
}

function cleanupCreatedConfig(record) {
  if (!record.configExisted && existsSync(record.configPath) && readFileSync(record.configPath).length === 0) {
    rmSync(record.configPath);
  }
}

function removeOwnedProxy(path, record, staged, paths) {
  const quarantineDir = quarantinePath(record, paths);
  if (path && existsSync(path)) {
    if (existsSync(quarantineDir)) {
      throw new Error(`Owned transaction layout drift detected for ${record.id}; removal stopped.`);
    }
    const expectedSkill = staged ? join(path, "SKILL.md") : record.proxySkillPath;
    const expectedPolicy = staged ? join(path, "agents", "openai.yaml") : record.proxyPolicyPath;
    assertOwnedFile(expectedSkill, record.proxySkillHash);
    assertOwnedFile(expectedPolicy, record.proxyPolicyHash);
    assertRemovablePath(path, paths, record, staged);
    assertOwnedProxyTree(path, record, staged);
    assertQuarantinePath(quarantineDir, record, paths);
    mkdirSync(dirname(quarantineDir), { recursive: true });
    renameSync(path, quarantineDir);
  }
  if (!existsSync(quarantineDir)) return;
  assertQuarantinePath(quarantineDir, record, paths);
  assertOwnedQuarantineTree(quarantineDir, record);
  rmSync(quarantineDir, { recursive: true });
}

function assertRemovablePath(path, paths, record, staged) {
  const target = resolve(path);
  const proxyRoot = resolve(record.proxyRoot ?? join(paths.agentsHome, "skills"));
  const stagingRoot = resolve(paths.stateRoot, "staging");
  const validProxy = dirname(target) === proxyRoot && basename(target).startsWith("skill-vault-");
  const validStaging = dirname(target) === stagingRoot && basename(target).startsWith("txn-");
  if ((staged && !validStaging) || (!staged && !validProxy)) {
    throw new Error(`Refusing to remove unexpected proxy path: ${path}`);
  }
}

function quarantinePath(record, paths) {
  return record.quarantineDir ?? join(paths.stateRoot, "quarantine", record.id);
}

function assertQuarantinePath(path, record, paths) {
  const target = resolve(path);
  const quarantineRoot = resolve(paths.stateRoot, "quarantine");
  if (dirname(target) !== quarantineRoot || basename(target) !== record.id || !basename(target).startsWith("txn-")) {
    throw new Error(`Refusing to remove unexpected quarantine path: ${path}`);
  }
}

function assertOwnedProxyTree(path, record, staged) {
  const rootStat = lstatSync(path);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Unexpected proxy content at ${path}; rollback stopped.`);
  }
  const expected = new Set(["SKILL.md", "agents", "agents/openai.yaml"]);
  const actual = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const entryRelative = relative(path, entryPath).split(sep).join("/");
      actual.add(entryRelative);
      if (entry.isSymbolicLink()) {
        throw new Error(`Unexpected proxy content at ${entryPath}; rollback stopped.`);
      }
      if (entry.isDirectory()) visit(entryPath);
    }
  };
  visit(path);
  if (actual.size !== expected.size || [...actual].some((item) => !expected.has(item))) {
    throw new Error(`Unexpected proxy content at ${path}; rollback stopped.`);
  }
  const expectedSkill = staged ? join(path, "SKILL.md") : record.proxySkillPath;
  const expectedPolicy = staged ? join(path, "agents", "openai.yaml") : record.proxyPolicyPath;
  assertOwnedFile(expectedSkill, record.proxySkillHash);
  assertOwnedFile(expectedPolicy, record.proxyPolicyHash);
}

function assertOwnedQuarantineTree(path, record) {
  const rootStat = lstatSync(path);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Unexpected quarantine content at ${path}; recovery stopped.`);
  }
  const allowed = new Set(["SKILL.md", "agents", "agents/openai.yaml"]);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const entryRelative = relative(path, entryPath).split(sep).join("/");
      if (!allowed.has(entryRelative) || entry.isSymbolicLink()) {
        throw new Error(`Unexpected quarantine content at ${entryPath}; recovery stopped.`);
      }
      if (entryRelative === "agents" && !entry.isDirectory()) {
        throw new Error(`Unexpected quarantine content at ${entryPath}; recovery stopped.`);
      }
      if (entryRelative !== "agents" && !entry.isFile()) {
        throw new Error(`Unexpected quarantine content at ${entryPath}; recovery stopped.`);
      }
      if (entry.isDirectory()) visit(entryPath);
    }
  };
  visit(path);
  const skillPath = join(path, "SKILL.md");
  const policyPath = join(path, "agents", "openai.yaml");
  if (existsSync(skillPath)) assertOwnedFile(skillPath, record.proxySkillHash);
  if (existsSync(policyPath)) assertOwnedFile(policyPath, record.proxyPolicyHash);
}

function assertOwnedFile(path, expectedHash) {
  if (!existsSync(path) || hash(readFileSync(path, "utf8")) !== expectedHash) {
    throw new Error(`Owned file drift detected at ${path}; rollback stopped.`);
  }
}

function nameConflicts(name, sourcePath, roots, managedPaths) {
  return scanSkills({ roots, managedPaths }).filter(
    (item) => item.name === name && item.path !== sourcePath && item.reasonCode !== "already_managed",
  );
}

function skillConfigControl(config, sourcePath) {
  let inSkillConfig = false;
  for (const line of config.split(/\r?\n/)) {
    if (/^\s*\[\[skills\.config\]\]\s*(?:#.*)?$/.test(line)) {
      inSkillConfig = true;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      inSkillConfig = false;
      continue;
    }
    if (!inSkillConfig || !/^\s*path\s*=/.test(line)) continue;
    const configuredPath = parseTomlPath(line);
    if (configuredPath === null) return "unverifiable";
    if (sameCanonicalPath(configuredPath, sourcePath)) return "controls_source";
  }
  return "clear";
}

function parseTomlPath(line) {
  const assignment = line.match(/^\s*path\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
  if (!assignment) return null;
  if (assignment[1].startsWith("'")) return assignment[1].slice(1, -1);
  try {
    return JSON.parse(assignment[1]);
  } catch {
    return null;
  }
}

function sameCanonicalPath(left, right) {
  if (left === right) return true;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function disableBlock(id, sourcePath) {
  return `# skill-vault:begin ${id}\n[[skills.config]]\npath = ${JSON.stringify(sourcePath)}\nenabled = false\n# skill-vault:end ${id}\n`;
}

function normalizeAppend(configBefore, block) {
  if (!configBefore) return block;
  return `${configBefore.endsWith("\n") ? "" : "\n"}\n${block}`;
}

function proxyRootFor(sourceSkillPath, paths) {
  let cursor = dirname(sourceSkillPath);
  while (true) {
    if (basename(cursor) === "skills" && basename(dirname(cursor)) === ".agents") return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return join(paths.agentsHome, "skills");
}

function proxyContent(name, transactionId) {
  return `---\nname: ${name}\ndescription: Explicit proxy for a user-approved vaulted skill.\n---\n\nRun \`skill-vault load --id ${transactionId}\` and follow the returned canonical instructions. Resolve any relative resources from the reported source root. Do not substitute remembered or inferred instructions if loading fails.\n`;
}

function proxyPolicy(name) {
  return `interface:\n  display_name: ${JSON.stringify(name)}\n  short_description: "Load the approved vaulted skill on demand"\n  default_prompt: ${JSON.stringify(`Use $${name} for this request.`)}\npolicy:\n  allow_implicit_invocation: false\n`;
}

function withMutationLock(paths, operation) {
  mkdirSync(paths.stateRoot, { recursive: true });
  const lockPath = join(paths.codexHome, "skill-vault.mutation.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST" || !recoverStaleDirectoryLock(lockPath)) {
        throw new Error("Another skill-vault mutation is active; no changes were made.");
      }
      continue;
    }
    try {
      writeFileSync(join(lockPath, "owner"), `${process.pid}\n`, { mode: 0o600 });
      acquired = true;
      break;
    } catch (error) {
      rmSync(lockPath, { recursive: true, force: true });
      throw error;
    }
  }
  if (!acquired) throw new Error("Could not acquire the skill-vault mutation lock.");
  try {
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function recoverStaleDirectoryLock(lockPath) {
  const claimPath = join(lockPath, "recovery");
  let claim;
  try {
    claim = openSync(claimPath, "wx", 0o600);
  } catch {
    return false;
  }
  let owner;
  try {
    owner = Number.parseInt(readFileSync(join(lockPath, "owner"), "utf8").trim(), 10);
    if (!Number.isSafeInteger(owner) || owner <= 0) return false;
    try {
      process.kill(owner, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") return false;
    }
    const entries = readdirSync(lockPath).sort();
    if (entries.join(",") !== "owner,recovery") return false;
    closeSync(claim);
    claim = undefined;
    rmSync(lockPath, { recursive: true });
    return true;
  } catch {
    return false;
  } finally {
    if (claim !== undefined) {
      closeSync(claim);
      rmSync(claimPath, { force: true });
    }
  }
}

function writeState(state, options) {
  const { stateRoot } = resolvePaths(options);
  mkdirSync(stateRoot, { recursive: true });
  const path = join(stateRoot, "state.json");
  const temporary = join(stateRoot, `.state-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function emptyState() {
  return { schemaVersion: STATE_VERSION, plans: [], transactions: [] };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
}
