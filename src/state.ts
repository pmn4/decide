import { readFileSync } from "node:fs";

/** Resolve -s state: literal, @file path, or - for stdin. */
export async function resolveState(raw: string): Promise<unknown> {
  if (raw === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return parseStateString(text);
  }
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    const text = readFileSync(path, "utf8");
    return parseStateString(text);
  }
  return parseStateString(raw);
}

function parseStateString(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

/** Parse value=desc pairs from CLI repeated -o / -l flags. */
export function parseKeyValuePairs(pairs: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      out[pair] = null;
    } else {
      out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return out;
}

/** Parse score levels: label=desc or plain label. */
export function parseLevelPairs(pairs: string[]): Array<string | { label: string; description?: string }> {
  return pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;
    return { label: pair.slice(0, eq), description: pair.slice(eq + 1) };
  });
}
