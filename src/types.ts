import { z } from "zod";

/** Normalized question types exposed by the CLI (engine-agnostic). */
export const YesNoQuestionSchema = z.object({
  name: z.string().min(1),
  type: z.literal("yesno"),
  instructions: z.string().min(1),
  criteria: z
    .object({
      true: z.string().optional(),
      false: z.string().optional(),
    })
    .optional(),
});

export const ChoiceQuestionSchema = z.object({
  name: z.string().min(1),
  type: z.literal("choice"),
  instructions: z.string().min(1),
  options: z.record(z.string(), z.string().nullable()).refine(
    (o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 255,
    "choice must have 1–255 options",
  ),
});

export const ScoreQuestionSchema = z.object({
  name: z.string().min(1),
  type: z.literal("score"),
  instructions: z.string().min(1),
  levels: z
    .array(z.union([z.string(), z.object({ label: z.string(), description: z.string().optional() })]))
    .min(2)
    .max(10),
});

export const QuestionSchema = z.discriminatedUnion("type", [
  YesNoQuestionSchema,
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
]);

export type YesNoQuestion = z.infer<typeof YesNoQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;
export type Question = z.infer<typeof QuestionSchema>;

export const RunRequestSchema = z.object({
  state: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]),
  questions: z.array(QuestionSchema).min(1),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

export type YesNoAnswer = { type: "yesno"; p: number; pass?: boolean };
export type ChoiceAnswer = {
  type: "choice";
  value: string;
  probs: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  labels: Record<string, string>;
  probs: Record<string, number>;
  confidence: number;
};
export type RefusalAnswer = { type: "refusal"; reason?: string };
export type TimeoutAnswer = { type: "timeout" };
export type AnswerError = { type: "error"; code: ErrorCode; message?: string };
export type NormalizedAnswer =
  | YesNoAnswer
  | ChoiceAnswer
  | ScoreAnswer
  | RefusalAnswer
  | TimeoutAnswer
  | AnswerError;

export const AnswerSchema = z.union([
  z.object({ type: z.literal("yesno"), p: z.number(), pass: z.boolean().optional() }),
  z.object({
    type: z.literal("choice"),
    value: z.string(),
    probs: z.record(z.number()),
    confidence: z.number(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    labels: z.record(z.string()),
    probs: z.record(z.number()),
    confidence: z.number(),
  }),
  z.object({ type: z.literal("refusal"), reason: z.string().optional() }),
  z.object({ type: z.literal("timeout") }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["auth", "rate_limit", "invalid", "engine", "timeout"]),
    message: z.string().optional(),
  }),
]);

export const ResultMetaSchema = z.object({
  profile: z.string(),
  engine: z.enum(["typesafe", "openai"]),
  model: z.string(),
});

export type ResultMeta = z.infer<typeof ResultMetaSchema>;

export const SuccessOutputSchema = z.object({
  ok: z.literal(true),
  profile: z.string(),
  engine: z.enum(["typesafe", "openai"]),
  model: z.string(),
  answers: z.record(AnswerSchema),
  usage: z.object({ input_tokens: z.number().optional() }).passthrough(),
  latency_ms: z.number(),
});

export type SuccessOutput = z.infer<typeof SuccessOutputSchema>;

export type ErrorCode = "auth" | "rate_limit" | "invalid" | "engine" | "timeout";

export type ErrorOutput = {
  ok: false;
  code: ErrorCode;
  message: string;
};

export const EXIT = {
  ok: 0,
  general: 1,
  auth: 2,
  rate_limit: 3,
  invalid: 4,
  engine: 5,
  /** Refusal, timeout, or per-answer error outcome (not a decision value). */
  outcome: 6,
} as const;

export type EngineId = "typesafe" | "openai";

export function isNonDecisionOutcome(
  answer: NormalizedAnswer | SuccessOutput["answers"][string],
): boolean {
  return answer.type === "refusal" || answer.type === "timeout" || answer.type === "error";
}
