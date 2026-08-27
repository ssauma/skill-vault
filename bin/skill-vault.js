#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { scanSkills, summarize } from "../lib/doctor.js";
import {
  applyPlan,
  createPlan,
  loadSkill,
  purgeState,
  readState,
  resolvePaths,
  rollbackAll,
} from "../lib/vault.js";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";
const json = takeFlag("--json");

try {
  switch (command) {
    case "init":
    case "doctor":
      doctor();
      break;
    case "plan":
      plan();
      break;
    case "apply":
      apply();
      break;
    case "status":
      status();
      break;
    case "load":
      load();
      break;
    case "rollback":
      rollback();
      break;
    case "uninstall":
      uninstall();
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    case "--version":
    case "-v":
      process.stdout.write("0.1.0\n");
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  else process.stderr.write(`skill-vault: ${error.message}\n`);
  process.exitCode = 1;
}

function doctor() {
  const state = readState();
  const managedPaths = new Set(state.transactions.map((item) => item.sourceSkillPath));
  const roots = valuesFor("--root").map((value) => resolve(value));
  const results = scanSkills({ ...(roots.length ? { roots } : {}), managedPaths });
  const report = { ok: true, readOnly: true, summary: summarize(results), skills: results };
  if (json) return output(report);
  outputDoctor(report);
}

function plan() {
  const selected = takeValue("--skill") ?? args.shift();
  if (!selected) throw new Error("Usage: skill-vault plan --skill /path/to/SKILL.md");
  if (!existsSync(selected)) throw new Error(`Skill path does not exist: ${selected}`);
  const result = createPlan(selected);
  output(json ? { ok: true, plan: result } : `Plan ${result.id} created for ${result.name}. Review it before: skill-vault apply ${result.id}`);
}

function apply() {
  const id = args.shift();
  if (!id) throw new Error("Usage: skill-vault apply <plan-id>");
  const result = applyPlan(id);
  output(json ? { ok: true, transaction: result, restartRequired: true } : `Applied ${result.id}. Restart Codex; invoke the skill with the same $${result.name} name.`);
}

function status() {
  const state = readState();
  const paths = resolvePaths();
  const report = {
    ok: true,
    stateRoot: paths.stateRoot,
    plans: state.plans,
    transactions: state.transactions,
  };
  output(json ? report : `${state.transactions.length} managed skill(s), ${state.plans.length} saved plan(s).\nState: ${paths.stateRoot}`);
}

function load() {
  const id = takeValue("--id") ?? args.shift();
  if (!id) throw new Error("Usage: skill-vault load --id <transaction-id>");
  const result = loadSkill(id);
  if (json) return output({ ok: true, ...result });
  process.stderr.write(`skill-vault source root: ${result.sourceRoot}\n`);
  process.stdout.write(result.content.endsWith("\n") ? result.content : `${result.content}\n`);
}

function rollback() {
  if (!takeFlag("--all")) throw new Error("v0.1 supports only: skill-vault rollback --all");
  const result = rollbackAll();
  output(json ? { ok: true, ...result, restartRequired: true } : `Rolled back ${result.rolledBack} skill(s). Restart Codex.`);
}

function uninstall() {
  const purge = takeFlag("--purge");
  const result = rollbackAll();
  if (purge) purgeState();
  output(json ? { ok: true, ...result, purged: purge } : `Rollback verified for ${result.rolledBack} skill(s).${purge ? " State purged." : " Recovery state retained."}`);
}

function outputDoctor(report) {
  const { summary } = report;
  process.stdout.write(
    [
      `Scanned: ${summary.scanned}`,
      `Isolation recommended: ${summary.counts.isolation_recommended}`,
      `No action needed: ${summary.counts.no_action_needed}`,
      `Unsuitable: ${summary.counts.unsuitable_for_isolation}`,
      `Estimated discovery characters: ${summary.estimatedDiscoveryChars}`,
      summary.note,
      "No files or settings were changed.",
    ].join("\n") + "\n",
  );
  for (const item of report.skills.filter((entry) => entry.recommendation === "isolation_recommended")) {
    process.stdout.write(`RECOMMEND ${item.name} (${item.discoveryChars} discovery chars) ${item.path}\n`);
  }
}

function help() {
  process.stdout.write(`skill-vault 0.1.0\n\nUsage:\n  skill-vault init [--json]\n  skill-vault doctor [--json] [--root PATH]\n  skill-vault plan --skill /path/to/SKILL.md [--json]\n  skill-vault apply <plan-id> [--json]\n  skill-vault status [--json]\n  skill-vault load --id <transaction-id> [--json]\n  skill-vault rollback --all [--json]\n  skill-vault uninstall [--purge] [--json]\n`);
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  args.splice(index, 2);
  return value;
}

function valuesFor(flag) {
  const values = [];
  while (args.includes(flag)) values.push(takeValue(flag));
  return values;
}

function output(value) {
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}
