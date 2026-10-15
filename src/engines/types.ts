import type { Question, NormalizedAnswer, ErrorCode } from "../types.js";
import type { FetchFn } from "../retry.js";

export interface EngineEvaluateResult {
  answers: Record<string, NormalizedAnswer>;
  usage: { input_tokens?: number; output_tokens?: number };
  rawModel?: string;
}

export interface EngineAdapter {
  id: "typesafe" | "openai";
  /** Build request body for fixture tests (no network). */
  buildRequest(state: unknown, model: string, questions: Question[]): unknown;
  /** Map a successful API response body to normalized answers. */
  mapResponse(
    body: unknown,
    questions: Question[],
  ): EngineEvaluateResult;
  /** Live call with auth + retry. */
  evaluate(
    fetchFn: FetchFn,
    apiKey: string,
    state: unknown,
    model: string,
    questions: Question[],
    opts?: { timeoutMs?: number },
  ): Promise<EngineEvaluateResult>;
}

export class EngineHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export function httpCodeToError(status: number, bodyText: string): EngineHttpError {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }
  if (status === 401) {
    return new EngineHttpError(status, "auth", "Invalid or missing API key", body);
  }
  if (status === 429) {
    return new EngineHttpError(status, "rate_limit", "Rate limit exceeded; retries exhausted", body);
  }
  if (status === 529) {
    return new EngineHttpError(status, "rate_limit", "Service overloaded; retries exhausted", body);
  }
  if (status === 422 || status === 400) {
    return new EngineHttpError(status, "invalid", "Request validation failed", body);
  }
  return new EngineHttpError(status, "engine", `HTTP ${status}`, body);
}
