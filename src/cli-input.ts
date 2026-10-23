import {
  parseQuestionsFile,
  readJsonFromPathOrStdin,
  readJsonlContexts,
  type FanContext,
} from "./batch.js";
import { buildSingleQuestion } from "./questions.js";
import { resolveState } from "./state.js";
import { RunnerError } from "./errors.js";
import type { Question } from "./types.js";

/** Inline JSON is recognized only by a leading `[` or `{` (no shape guessing). */
export function looksLikeInlineJson(raw: string): boolean {
  const t = raw.trimStart();
  return t.startsWith("[") || t.startsWith("{");
}

/** Strip optional `@` file prefix for path arguments (not used for inline JSON). */
export function stripAtFilePrefix(raw: string): string {
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

export function parseNameInstructionsPair(pair: string): { name: string; instructions: string } {
  const eq = pair.indexOf("=");
  if (eq === -1) {
    throw new RunnerError("invalid", `Expected name=instructions, got "${pair}".`);
  }
  const name = pair.slice(0, eq);
  const instructions = pair.slice(eq + 1);
  if (!name || !instructions) {
    throw new RunnerError("invalid", `Expected name=instructions, got "${pair}".`);
  }
  return { name, instructions };
}

export function parseContextPair(pair: string): { id?: string; source: string } {
  const eq = pair.indexOf("=");
  if (eq === -1) {
    return { source: pair };
  }
  const id = pair.slice(0, eq);
  const source = pair.slice(eq + 1);
  if (!id || !source) {
    throw new RunnerError("invalid", `Expected id=@file|text for --context, got "${pair}".`);
  }
  return { id, source };
}

function buildAskQuestions(
  kind: "yesno" | "choice" | "score",
  askPairs: string[],
  optionFlags: string[],
  levelFlags: string[],
): Question[] {
  const out: Question[] = [];
  for (const pair of askPairs) {
    const { name, instructions } = parseNameInstructionsPair(pair);
    try {
      out.push(buildSingleQuestion(kind, name, instructions, optionFlags, levelFlags));
    } catch (e) {
      throw new RunnerError("invalid", e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

export async function resolveQuestionsInput(opts: {
  kind: "yesno" | "choice" | "score";
  questionsFlag?: string | boolean;
  askPairs: string[];
  optionFlags: string[];
  levelFlags: string[];
}): Promise<Question[]> {
  const { kind, questionsFlag, askPairs, optionFlags, levelFlags } = opts;

  if (questionsFlag === undefined) {
    if (askPairs.length > 0) {
      throw new RunnerError("invalid", "--ask requires --questions (batch mode).");
    }
    throw new RunnerError("invalid", "resolveQuestionsInput called without --questions.");
  }

  let fromSource: Question[] = [];
  if (questionsFlag !== true && questionsFlag !== "") {
    const raw = String(questionsFlag);
    if (looksLikeInlineJson(raw)) {
      fromSource = parseQuestionsFile(JSON.parse(raw));
    } else {
      const path = stripAtFilePrefix(raw);
      fromSource = parseQuestionsFile(await readJsonFromPathOrStdin(path));
    }
  }

  const fromAsk = buildAskQuestions(kind, askPairs, optionFlags, levelFlags);
  const merged = [...fromSource, ...fromAsk];
  if (merged.length === 0) {
    throw new RunnerError(
      "invalid",
      "--questions needs a file, inline JSON, stdin (-), and/or one or more --ask name=instructions.",
    );
  }
  return merged;
}

async function contextStateFromInlineEntry(
  entry: string | { id?: string; state: unknown },
  index: number,
): Promise<FanContext> {
  if (typeof entry === "string") {
    const state = await resolveState(entry);
    return { id: String(index), state };
  }
  if (entry && typeof entry === "object" && "state" in entry) {
    const id = entry.id ?? String(index);
    const rawState = entry.state;
    const state =
      typeof rawState === "string" ? await resolveState(rawState) : rawState;
    return { id, state };
  }
  throw new RunnerError(
    "invalid",
    "Inline --contexts JSON must be an array of strings or {id?, state} objects.",
  );
}

export async function parseInlineContextsJson(raw: string): Promise<FanContext[]> {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new RunnerError("invalid", "Inline --contexts must be a JSON array.");
  }
  if (parsed.length === 0) {
    throw new RunnerError("invalid", "No contexts in --contexts input.");
  }
  const out: FanContext[] = [];
  for (let i = 0; i < parsed.length; i++) {
    out.push(await contextStateFromInlineEntry(parsed[i] as string | { id?: string; state: unknown }, i));
  }
  return out;
}

async function contextsFromRepeatableFlags(pairs: string[]): Promise<FanContext[]> {
  if (pairs.length === 0) return [];
  const out: FanContext[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const { id, source } = parseContextPair(pairs[i]);
    const state = await resolveState(source);
    out.push({ id: id ?? String(i), state });
  }
  return out;
}

export async function resolveContextsInput(opts: {
  contextsFlag?: string | boolean;
  contextPairs: string[];
}): Promise<FanContext[]> {
  const { contextsFlag, contextPairs } = opts;

  if (contextsFlag === undefined && contextPairs.length === 0) {
    throw new RunnerError("invalid", "resolveContextsInput called without --contexts.");
  }

  let fromSource: FanContext[] = [];
  if (contextsFlag !== undefined && contextsFlag !== true && contextsFlag !== "") {
    const raw = String(contextsFlag);
    if (looksLikeInlineJson(raw)) {
      fromSource = await parseInlineContextsJson(raw);
    } else {
      const path = stripAtFilePrefix(raw);
      fromSource = await readJsonlContexts(path);
    }
  }

  const fromFlags = await contextsFromRepeatableFlags(contextPairs);
  const merged = [...fromSource, ...fromFlags];
  if (merged.length === 0) {
    throw new RunnerError(
      "invalid",
      "--contexts needs a JSONL file, inline JSON array, stdin (-), and/or one or more -c/--context id=text|@file.",
    );
  }
  return merged;
}

export function questionsBatchActive(questionsFlag?: string | boolean, askCount = 0): boolean {
  return questionsFlag !== undefined || askCount > 0;
}

export function contextsBatchActive(contextsFlag?: string | boolean, contextPairCount = 0): boolean {
  return contextsFlag !== undefined || contextPairCount > 0;
}
