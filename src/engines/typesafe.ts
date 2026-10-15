import type { Question, NormalizedAnswer, ChoiceQuestion, ScoreQuestion, YesNoQuestion } from "../types.js";
import { fetchWithRetry, type FetchFn } from "../retry.js";
import {
  type EngineAdapter,
  type EngineEvaluateResult,
  EngineHttpError,
  httpCodeToError,
} from "./types.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

function buildTypesafeQuestion(q: Question): Record<string, unknown> {
  switch (q.type) {
    case "yesno": {
      const nq = q as YesNoQuestion;
      const out: Record<string, unknown> = {
        type: "noul",
        instructions: nq.instructions,
      };
      if (nq.criteria?.true || nq.criteria?.false) {
        out.criteria = {
          true: nq.criteria.true,
          false: nq.criteria.false,
        };
      }
      return out;
    }
    case "choice": {
      const cq = q as ChoiceQuestion;
      return {
        type: "choice",
        instructions: cq.instructions,
        criteria: cq.options,
      };
    }
    case "score": {
      const sq = q as ScoreQuestion;
      const criteria = sq.levels.map((level) => {
        if (typeof level === "string") return level;
        return level.description ? `${level.label}: ${level.description}` : level.label;
      });
      return {
        type: "score",
        instructions: sq.instructions,
        criteria,
      };
    }
  }
}

function mapNoulAnswer(p: number): NormalizedAnswer {
  return { type: "yesno", p };
}

function mapChoiceAnswer(
  choice: string,
  probabilities: Record<string, number>,
  confidence: number,
): NormalizedAnswer {
  return { type: "choice", value: choice, probs: probabilities, confidence };
}

function mapScoreAnswer(
  score: number,
  legend: Record<string, string>,
  probabilities: Record<string, number>,
  confidence: number,
): NormalizedAnswer {
  return { type: "score", score, labels: legend, probs: probabilities, confidence };
}

export const typesafeAdapter: EngineAdapter = {
  id: "typesafe",

  buildRequest(state: unknown, model: string, questions: Question[]) {
    const qs: Record<string, unknown> = {};
    for (const q of questions) {
      qs[q.name] = buildTypesafeQuestion(q);
    }
    return { state, model, questions: qs };
  },

  mapResponse(body: unknown, questions: Question[]): EngineEvaluateResult {
    const data = body as {
      model?: string;
      answers?: Record<string, Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const answers: Record<string, NormalizedAnswer> = {};
    for (const q of questions) {
      const raw = data.answers?.[q.name];
      if (!raw) {
        throw new Error(`Missing answer for question "${q.name}"`);
      }
      const t = raw.type as string;
      if (t === "noul") {
        answers[q.name] = mapNoulAnswer(raw.noul as number);
      } else if (t === "choice") {
        answers[q.name] = mapChoiceAnswer(
          raw.choice as string,
          raw.probabilities as Record<string, number>,
          raw.confidence as number,
        );
      } else if (t === "score") {
        answers[q.name] = mapScoreAnswer(
          raw.score as number,
          raw.legend as Record<string, string>,
          raw.probabilities as Record<string, number>,
          raw.confidence as number,
        );
      } else {
        throw new Error(`Unexpected typesafe answer type: ${t}`);
      }
    }
    return {
      answers,
      usage: { input_tokens: data.usage?.input_tokens, output_tokens: data.usage?.output_tokens },
      rawModel: data.model,
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
