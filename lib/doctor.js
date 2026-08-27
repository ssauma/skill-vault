import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { parseFrontmatter } from "./frontmatter.js";

const DEFAULT_DESCRIPTION_THRESHOLD = 500;

export function inspectSkill(skillPath, options = {}) {
  const requestedPath = resolve(skillPath);
  let absolutePath = requestedPath;
  let content;
  try {
    absolutePath = realpathSync(requestedPath);
    content = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return resultFor(absolutePath, {
      recommendation: "unsuitable_for_isolation",
      reasonCode: "unreadable_skill",
      detail: error.message,
    });
  }

  const parsed = parseFrontmatter(content);
  const name = parsed.metadata.name ?? null;
  const description = parsed.metadata.description ?? "";
  const activationBytes = Buffer.byteLength(content);
  const discoveryChars = (name?.length ?? 0) + description.length + absolutePath.length + 16;
  const base = { name, description, activationBytes, discoveryChars };

  if (parsed.error || !validSkillName(name) || !description) {
    return resultFor(absolutePath, {
      ...base,
      recommendation: "unsuitable_for_isolation",
      reasonCode: "invalid_skill_metadata",
    });
  }
  if (isGeneratedOrManagedSource(absolutePath)) {
    return resultFor(absolutePath, {
      ...base,
      recommendation: "unsuitable_for_isolation",
      reasonCode: "managed_or_generated_source",
    });
  }
  if (options.managedPaths?.has(absolutePath)) {
    return resultFor(absolutePath, {
      ...base,
      recommendation: "unsuitable_for_isolation",
      reasonCode: "already_managed",
    });
  }
  const threshold = options.descriptionThreshold ?? DEFAULT_DESCRIPTION_THRESHOLD;
  if (description.length > threshold || discoveryChars > threshold + 200) {
    return resultFor(absolutePath, {
      ...base,
      recommendation: "isolation_recommended",
      reasonCode: "oversized_discovery_metadata",
    });
  }
  return resultFor(absolutePath, {
    ...base,
    recommendation: "no_action_needed",
    reasonCode: "progressive_disclosure_already_effective",
  });
}

export function scanSkills(options = {}) {
  const roots = options.roots ?? defaultSkillRoots(options);
  const managedPaths = options.managedPaths ?? new Set();
  const found = new Map();
  const visitedDirectories = new Set();

  for (const root of roots) walk(root, found, visitedDirectories);

  return [...found.values()]
    .map((path) => inspectSkill(path, { ...options, managedPaths }))
    .sort((left, right) => right.discoveryChars - left.discoveryChars || left.path.localeCompare(right.path));
}

export function summarize(results) {
  const counts = {
    isolation_recommended: 0,
    no_action_needed: 0,
    unsuitable_for_isolation: 0,
  };
  for (const result of results) counts[result.recommendation] += 1;
  return {
    scanned: results.length,
    counts,
    estimatedDiscoveryChars: results.reduce((sum, item) => sum + item.discoveryChars, 0),
    note: "SKILL.md bodies are activation cost, not session-start cost; discovery metadata is the startup metric.",
  };
}

export function defaultSkillRoots(options = {}) {
  const userHome = options.home ?? homedir();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(userHome, ".codex");
  const roots = [
    join(userHome, ".agents", "skills"),
    join(codexHome, "skills"),
    join(codexHome, "plugins", "cache"),
  ];
  let current = resolve(options.cwd ?? process.cwd());
  while (true) {
    roots.push(join(current, ".agents", "skills"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (process.platform !== "win32") roots.push("/etc/codex/skills");
  return [...new Set(roots)];
}

function walk(root, found, visitedDirectories) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    return;
  }
  if (visitedDirectories.has(canonicalRoot)) return;
  visitedDirectories.add(canonicalRoot);
  let entries;
  try {
    entries = readdirSync(canonicalRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(canonicalRoot, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const target = realpathSync(path);
        const stat = lstatSync(target);
        if (stat.isDirectory()) walk(target, found, visitedDirectories);
        else if (entry.name === "SKILL.md") found.set(target, target);
      } catch {
        // Broken or unreadable links are ignored by the read-only scan.
      }
    } else if (entry.isDirectory()) {
      walk(path, found, visitedDirectories);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      const absolute = resolve(path);
      found.set(absolute, absolute);
    }
  }
}

function isGeneratedOrManagedSource(path) {
  const normalized = path.split(sep).join("/");
  return (
    normalized.includes("/.codex/plugins/cache/") ||
    normalized.includes("/.codex/skills/.system/") ||
    normalized.includes("/.codex/vendor_imports/") ||
    normalized.startsWith("/etc/codex/skills/") ||
    normalized.includes("/skill-vault/proxies/") ||
    normalized.includes("/skills/skill-vault-")
  );
}

function validSkillName(name) {
  return typeof name === "string" && name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function resultFor(path, fields) {
  return {
    path,
    name: fields.name ?? null,
    description: fields.description ?? "",
    discoveryChars: fields.discoveryChars ?? 0,
    activationBytes: fields.activationBytes ?? 0,
    recommendation: fields.recommendation,
    reasonCode: fields.reasonCode,
    ...(fields.detail ? { detail: fields.detail } : {}),
  };
}
