export function parseFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { metadata: {}, body: normalized, error: "missing_frontmatter" };
  }

  const lines = normalized.split(/\r?\n/);
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) return { metadata: {}, body: normalized, error: "unclosed_frontmatter" };

  const metadata = {};
  for (let index = 1; index < closing; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if ((rawValue === ">" || rawValue === "|") && index + 1 < closing) {
      const value = [];
      while (index + 1 < closing && /^\s+/.test(lines[index + 1])) {
        index += 1;
        value.push(lines[index].trim());
      }
      metadata[key] = value.join(rawValue === ">" ? " " : "\n").trim();
    } else {
      metadata[key] = unquote(rawValue.trim());
    }
  }

  return { metadata, body: lines.slice(closing + 1).join("\n"), error: null };
}

function unquote(value) {
  if (value.length < 2) return value;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}
