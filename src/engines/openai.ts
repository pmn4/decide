import type { Question, NormalizedAnswer, ChoiceQuestion, ScoreQuestion } from "../types.js";
import { fetchWithRetry, type FetchFn } from "../retry.js";
import {
  type EngineAdapter,
  type EngineEvaluateResult,
  httpCodeToError,
} from "./types.js";

const ENDPOINT = "https://api.openai.com/v1/decisions";

function buildOpenAIQuestion(q: Question): Record<string, unknown> {
  const base = { name: q.name, instructions: q.instructions };
  switch (q.type) {
    case "yesno":
      return { type: "predicate", ...base };
    case "choice": {
      const cq = q as ChoiceQuestion;
      return {
        type: "choice",
        ...base,
        choices: Object.entries(cq.options).map(([value, description]) => ({
          value,
          description: description ?? "",
        })),
      };
    }
    case "score": {
      const sq = q as ScoreQuestion;
      return {
        type: "score",
        ...base,
        levels: sq.levels.map((level, i) => {
          if (typeof level === "string") {
            return { label: String(i), description: level };
          }
          return { label: level.label, description: level.description ?? "" };
        }),
      };
    }
  }
}

function probsArrayToRecord(
  items: Array<{ value: string | number; probability: number; label?: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[String(item.value)] = item.probability;
  }
  return out;
}

export const openaiAdapter: EngineAdapter = {
  id: "openai",

  buildRequest(state: unknown, model: string, questions: Question[]) {
    const input =
      typeof state === "string"
        ? state
        : JSON.stringify(state);
    return {
      model,
      input,
      questions: questions.map(buildOpenAIQuestion),
    };
  },

  mapResponse(body: unknown, questions: Question[]): EngineEvaluateResult {
    const data = body as {
      answers?: Array<Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const byName = new Map<string, Record<string, unknown>>();
    for (const a of data.answers ?? []) {
      const name = a.name as string;
      if (name) byName.set(name, a);
    }
    const answers: Record<string, NormalizedAnswer> = {};
    for (const q of questions) {
      const raw = byName.get(q.name);
      if (!raw) {
        throw new Error(`Missing answer for question "${q.name}"`);
      }
      const t = raw.type as string;
      if (t === "refusal") {
        answers[q.name] = {
          type: "refusal",
          reason:
            (raw.reason as string | undefined) ??
            (raw.refusal_reason as string | undefined) ??
            (raw.message as string | undefined),
        };
        continue;
      }
      if (t === "predicate") {
        answers[q.name] = { type: "yesno", p: raw.probability as number };
      } else if (t === "choice") {
        const probsList = raw.probabilities as Array<{ value: string; probability: number }>;
        answers[q.name] = {
          type: "choice",
          value: String(raw.choice),
          probs: probsArrayToRecord(probsList),
          confidence: raw.confidence as number,
        };
      } else if (t === "score") {
        const probsList = raw.probabilities as Array<{
          value: number;
          label?: string;
          probability: number;
        }>;
        const labels: Record<string, string> = {};
        for (const p of probsList) {
          labels[String(p.value)] = p.label ?? String(p.value);
        }
        answers[q.name] = {
          type: "score",
          score: raw.score as number,
          labels,
          probs: probsArrayToRecord(probsList),
          confidence: raw.confidence as number,
        };
      } else {
        throw new Error(`Unexpected openai answer type: ${t}`);
      }
    }
    return {
      answers,
      usage: { input_tokens: data.usage?.input_tokens, output_tokens: data.usage?.output_tokens },
    };
  },

  async evaluate(fetchFn, apiKey, state, model, questions, opts) {
    const body = this.buildRequest(state, model, questions);
    const res = await fetchWithRetry(
      fetchFn,
      ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: opts?.timeoutMs },
    );
    const text = await res.text();
    if (!res.ok) {
      throw httpCodeToError(res.status, text);
    }
    return this.mapResponse(JSON.parse(text), questions);
  },
};
