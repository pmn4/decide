import { z } from "zod";
import type { Question, SuccessOutput, NormalizedAnswer } from "./types.js";
import { QuestionSchema } from "./types.js";
import type { EngineAdapter } from "./engines/types.js";
import {
  MAX_QUESTIONS_PER_REQUEST,
  MAX_REQUEST_BODY_BYTES,
  estimateRequestBytes,
} from "./limits.js";
import { RunnerError } from "./errors.js";
import type { StampFields } from "./meta.js";
import { buildSuccessOutput } from "./meta.js";

export function splitQuestionChunks(
  adapter: EngineAdapter,
  state: unknown,
  model: string,
  questions: Question[],
): Question[][] {
  if (questions.length === 0) {
    throw new RunnerError("invalid", "No questions to evaluate.");
  }

  const chunks: Question[][] = [];
  let current: Question[] = [];

  for (const q of questions) {
    const next = [...current, q];
    const bytes = estimateRequestBytes(adapter.buildRequest(state, model, next));
    const overSize = bytes > MAX_REQUEST_BODY_BYTES;
    const overCount = next.length > MAX_QUESTIONS_PER_REQUEST;

    if (current.length > 0 && (overSize || overCount)) {
      chunks.push(current);
      current = [q];
      const soloBytes = estimateRequestBytes(adapter.buildRequest(state, model, current));
      if (soloBytes > MAX_REQUEST_BODY_BYTES) {
        throw new RunnerError(
          "invalid",
          `Question "${q.name}" alone exceeds the engine request size limit.`,
        );
      }
    } else {
      current = next;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export async function runBatch(
  evaluateChunk: (
    state: unknown,
    questions: Question[],
  ) => Promise<{ answers: Record<string, NormalizedAnswer>; usage: { input_tokens?: number } }>,
  stamp: StampFields,
  adapter: EngineAdapter,
  state: unknown,
  questions: Question[],
  startedAt: number,
): Promise<SuccessOutput> {
  const chunks = splitQuestionChunks(adapter, state, stamp.model, questions);
  const mergedAnswers: Record<string, NormalizedAnswer> = {};
  let inputTokens = 0;

  for (const chunk of chunks) {
    const part = await evaluateChunk(state, chunk);
    Object.assign(mergedAnswers, part.answers);
    inputTokens += part.usage.input_tokens ?? 0;
  }

  return buildSuccessOutput(
    stamp,
    mergedAnswers,
    { input_tokens: inputTokens, request_chunks: chunks.length },
    Date.now() - startedAt,
  );
}

export type FanContext = { id: string; state: unknown };

export type FanSuccessOutput = {
  ok: true;
  profile: string;
  engine: StampFields["engine"];
  model: string;
  results: Record<
    string,
    | { answer: SuccessOutput["answers"][string] }
    | { error: { code: string; message: string } }
  >;
  usage: { input_tokens?: number };
  latency_ms: number;
};

export async function runFan(
  stamp: StampFields,
  evaluateOne: (
    state: unknown,
    question: Question,
  ) => Promise<{ answer: NormalizedAnswer; usage: { input_tokens?: number } }>,
  contexts: FanContext[],
  question: Question,
  concurrency: number,
  startedAt: number,
): Promise<FanSuccessOutput> {
  if (contexts.length === 0) {
    throw new RunnerError("invalid", "No contexts in --contexts input.");
  }

  const results: FanSuccessOutput["results"] = {};
  let inputTokens = 0;
  let index = 0;

  async function worker(): Promise<void> {
    while (index < contexts.length) {
      const i = index++;
      const ctx = contexts[i];
      try {
        const { answer, usage } = await evaluateOne(ctx.state, question);
        const stamped = buildSuccessOutput(
          stamp,
          { [question.name]: answer },
          { input_tokens: usage.input_tokens ?? 0 },
          0,
        ).answers[question.name];
        results[ctx.id] = { answer: stamped };
        inputTokens += usage.input_tokens ?? 0;
      } catch (e) {
        const err =
          e instanceof RunnerError
            ? e
            : new RunnerError("engine", e instanceof Error ? e.message : String(e));
        results[ctx.id] = { error: { code: err.code, message: err.message } };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, contexts.length) }, () => worker());
  await Promise.all(workers);

  return {
    ok: true,
    profile: stamp.profileName,
    engine: stamp.engine,
    model: stamp.model,
    results,
    usage: { input_tokens: inputTokens },
    latency_ms: Date.now() - startedAt,
  };
}

export async function readJsonFromPathOrStdin(path: string): Promise<unknown> {
  if (path === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) {
      chunks.push(c as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function readJsonlContexts(path: string): Promise<FanContext[]> {
  let text: string;
  if (path === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) {
      chunks.push(c as Buffer);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    const { readFileSync } = await import("node:fs");
    text = readFileSync(path, "utf8");
  }
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const out: FanContext[] = [];
  for (const line of lines) {
    const row = JSON.parse(line) as { id?: string; state?: unknown };
    if (!row.id || row.state === undefined) {
      throw new RunnerError("invalid", "Each JSONL line must be {id, state}.");
    }
    out.push({ id: row.id, state: row.state });
  }
  return out;
}

export function parseQuestionsFile(json: unknown): Question[] {
  let list: unknown;
  if (Array.isArray(json)) {
    list = json;
  } else if (json && typeof json === "object" && "questions" in json) {
    list = (json as { questions: unknown }).questions;
  } else {
    throw new RunnerError("invalid", "--questions file must be a JSON array or {questions:[...]}.");
  }
  const parsed = z.array(QuestionSchema).safeParse(list);
  if (!parsed.success) {
    throw new RunnerError("invalid", parsed.error.message);
  }
  return parsed.data;
}
