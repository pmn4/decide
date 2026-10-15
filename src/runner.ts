import { createProfileAuth } from "./auth.js";
import {
  loadConfig,
  resolveProfile,
  requestTimeoutMs,
  type Profile,
} from "./config.js";
import { RunnerError } from "./errors.js";
import { getEngineAdapter, EngineHttpError, type EngineAdapter } from "./engines/index.js";
import type { Question, SuccessOutput, ErrorOutput, NormalizedAnswer } from "./types.js";
import { RunRequestSchema } from "./types.js";
import type { FetchFn } from "./retry.js";
import { FetchTimeoutError } from "./retry.js";
import { runBatch, runFan, type FanContext, type FanSuccessOutput } from "./batch.js";
import { buildSuccessOutput } from "./meta.js";
import { profileEnvVar } from "./config.js";

export interface RunOptions {
  profile?: string;
  fetch?: FetchFn;
  cwd?: string;
}

export interface ResolvedRuntime {
  profile: Profile;
  profileName: string;
  adapter: EngineAdapter;
  apiKey: string;
  fetchFn: FetchFn;
  timeoutMs: number;
}

export async function resolveRuntime(opts: RunOptions = {}): Promise<ResolvedRuntime> {
  const config = loadConfig();
  const { name, profile } = resolveProfile(config, opts.profile, opts.cwd ?? process.cwd());
  const adapter = getEngineAdapter(profile.engine);
  const auth = createProfileAuth(name, profile.engine);
  const apiKey = await auth.getApiKey();
  if (!apiKey) {
    throw new RunnerError(
      "auth",
      `No API key for profile "${name}". Set ${profileEnvVar(name)} or run \`decide login\`.`,
    );
  }
  return {
    profile,
    profileName: name,
    adapter,
    apiKey,
    fetchFn: opts.fetch ?? fetch,
    timeoutMs: requestTimeoutMs(config),
  };
}

function stampFields(rt: ResolvedRuntime) {
  return {
    profileName: rt.profileName,
    engine: rt.profile.engine,
    model: rt.profile.model,
    profile: rt.profile,
  };
}

async function evaluateChunk(
  rt: ResolvedRuntime,
  state: unknown,
  questions: Question[],
): Promise<{ answers: Record<string, NormalizedAnswer>; usage: { input_tokens?: number } }> {
  try {
    const result = await rt.adapter.evaluate(
      rt.fetchFn,
      rt.apiKey,
      state,
      rt.profile.model,
      questions,
      { timeoutMs: rt.timeoutMs },
    );
    return { answers: result.answers, usage: { input_tokens: result.usage.input_tokens } };
  } catch (e) {
    if (e instanceof EngineHttpError) {
      throw new RunnerError(e.code, e.message);
    }
    if (e instanceof FetchTimeoutError) {
      throw new RunnerError("timeout", e.message);
    }
    throw e;
  }
}

export async function runDecision(
  state: unknown,
  questions: Question[],
  opts: RunOptions = {},
): Promise<SuccessOutput> {
  const rt = await resolveRuntime(opts);
  const start = Date.now();
  try {
    if (questions.length === 1) {
      const part = await evaluateChunk(rt, state, questions);
      return buildSuccessOutput(
        stampFields(rt),
        part.answers,
        { input_tokens: part.usage.input_tokens },
        Date.now() - start,
      );
    }
    return runBatch(
      (s, qs) => evaluateChunk(rt, s, qs),
      stampFields(rt),
      rt.adapter,
      state,
      questions,
      start,
    );
  } catch (e) {
    if (e instanceof EngineHttpError) {
      throw new RunnerError(e.code, e.message);
    }
    if (e instanceof RunnerError) throw e;
    throw new RunnerError("engine", e instanceof Error ? e.message : String(e));
  }
}

export async function runFanDecision(
  question: Question,
  contexts: FanContext[],
  concurrency: number,
  opts: RunOptions = {},
): Promise<FanSuccessOutput> {
  const rt = await resolveRuntime(opts);
  const start = Date.now();
  return runFan(
    stampFields(rt),
    async (state, q) => {
      const part = await evaluateChunk(rt, state, [q]);
      const answer = part.answers[q.name];
      if (!answer) {
        throw new RunnerError("engine", `Missing answer for "${q.name}"`);
      }
      return { answer, usage: part.usage };
    },
    contexts,
    question,
    concurrency,
    start,
  );
}

export async function runFromJson(json: unknown, opts: RunOptions = {}): Promise<SuccessOutput> {
  const parsed = RunRequestSchema.safeParse(json);
  if (!parsed.success) {
    throw new RunnerError("invalid", parsed.error.message);
  }
  return runDecision(parsed.data.state, parsed.data.questions, opts);
}

export function errorOutput(
  err: RunnerError | { code: ErrorOutput["code"]; message: string },
): ErrorOutput {
  return { ok: false, code: err.code, message: err.message };
}

export { RunnerError } from "./errors.js";
