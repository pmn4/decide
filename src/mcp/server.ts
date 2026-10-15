import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { dispatchQuestionCommand } from "../dispatch.js";
import { runFromJson } from "../runner.js";
import { RunnerError } from "../errors.js";
import { QuestionSchema, RunRequestSchema } from "../types.js";

const StateSchema = z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]);

const BaseToolSchema = z.object({
  profile: z.string().optional(),
  name: z.string().optional(),
  concurrency: z.number().int().positive().optional(),
});

const SingleYesNoSchema = BaseToolSchema.extend({
  instructions: z.string(),
  state: StateSchema,
});

const BatchSchema = BaseToolSchema.extend({
  state: StateSchema,
  questions: z.array(QuestionSchema).min(1),
});

const FanYesNoSchema = BaseToolSchema.extend({
  instructions: z.string(),
  contexts: z
    .array(z.object({ id: z.string(), state: StateSchema }))
    .min(1),
});

const ChoiceOptionsSchema = z.record(z.string(), z.string().nullable());

const SingleChoiceSchema = SingleYesNoSchema.extend({
  options: ChoiceOptionsSchema,
});

const FanChoiceSchema = FanYesNoSchema.extend({
  options: ChoiceOptionsSchema,
});

const LevelSchema = z.union([
  z.string(),
  z.object({ label: z.string(), description: z.string().optional() }),
]);

const SingleScoreSchema = SingleYesNoSchema.extend({
  levels: z.array(LevelSchema).min(2).max(10),
});

const FanScoreSchema = FanYesNoSchema.extend({
  levels: z.array(LevelSchema).min(2).max(10),
});

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function invalid(message: string) {
  return textResult({ ok: false, code: "invalid", message });
}

function assertExclusive(hasBatch: boolean, hasFan: boolean, hasSingle: boolean) {
  const modes = [hasBatch, hasFan, hasSingle].filter(Boolean).length;
  if (modes > 1) {
    throw new RunnerError(
      "invalid",
      "Use one mode: default single (state + instructions), batch (questions), or fan (contexts).",
    );
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "decide", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "yesno",
        description: "Single yes/no by default. Pass questions[] for batch or contexts[] for fan.",
        inputSchema: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            state: {},
            name: { type: "string" },
            profile: { type: "string" },
            questions: { type: "array", items: { type: "object" } },
            contexts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, state: {} },
                required: ["id", "state"],
              },
            },
            concurrency: { type: "number" },
          },
        },
      },
      {
        name: "choice",
        description: "Single choice by default. Batch via questions[]; fan via contexts[].",
        inputSchema: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            state: {},
            options: { type: "object" },
            questions: { type: "array" },
            contexts: { type: "array" },
            profile: { type: "string" },
            concurrency: { type: "number" },
          },
        },
      },
      {
        name: "score",
        description: "Single score by default. Batch via questions[]; fan via contexts[].",
        inputSchema: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            state: {},
            levels: { type: "array" },
            questions: { type: "array" },
            contexts: { type: "array" },
            profile: { type: "string" },
            concurrency: { type: "number" },
          },
        },
      },
      {
        name: "run",
        description: "Normalized multi-question request ({state, questions}).",
        inputSchema: { type: "object", properties: { state: {}, questions: { type: "array" } } },
      },
      {
        name: "batch",
        description: "Explicit batch: one state, many questions (same as --questions).",
        inputSchema: { type: "object", properties: { state: {}, questions: { type: "array" } } },
      },
      {
        name: "fan_yesno",
        description: "Explicit fan: one yes/no question across many contexts.",
        inputSchema: { type: "object" },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const args = req.params.arguments ?? {};

      if (req.params.name === "run") {
        const parsed = RunRequestSchema.safeParse(args);
        if (!parsed.success) return invalid(parsed.error.message);
        return textResult(await runFromJson(parsed.data, { profile: args.profile as string }));
      }

      if (req.params.name === "batch") {
        const parsed = BatchSchema.safeParse(args);
        if (!parsed.success) return invalid(parsed.error.message);
        const out = await dispatchQuestionCommand({
          kind: "yesno",
          qFlags: [],
          stateInline: parsed.data.state,
          questionsInline: parsed.data.questions,
          profile: parsed.data.profile,
        });
        return textResult(out);
      }

      const kind =
        req.params.name === "choice"
          ? "choice"
          : req.params.name === "score"
            ? "score"
            : "yesno";

      if (req.params.name === "fan_yesno") {
        const parsed = FanYesNoSchema.safeParse(args);
        if (!parsed.success) return invalid(parsed.error.message);
        const out = await dispatchQuestionCommand({
          kind: "yesno",
          qFlags: [parsed.data.instructions],
          contextsInline: parsed.data.contexts,
          name: parsed.data.name,
          concurrency: parsed.data.concurrency,
          profile: parsed.data.profile,
        });
        return textResult(out);
      }

      const hasQuestions = Array.isArray(args.questions);
      const hasContexts = Array.isArray(args.contexts);
      const hasSingle = args.instructions !== undefined && args.state !== undefined;

      if (req.params.name === "yesno" || req.params.name === "choice" || req.params.name === "score") {
        assertExclusive(hasQuestions, hasContexts, hasSingle);

        if (hasQuestions) {
          const batch = BatchSchema.extend({
            questions: z.array(QuestionSchema),
          }).safeParse(args);
          if (!batch.success) return invalid(batch.error.message);
          const out = await dispatchQuestionCommand({
            kind,
            qFlags: [],
            stateInline: batch.data.state,
            questionsInline: batch.data.questions,
            profile: batch.data.profile,
          });
          return textResult(out);
        }

        if (hasContexts) {
          if (kind === "choice") {
            const parsed = FanChoiceSchema.safeParse(args);
            if (!parsed.success) return invalid(parsed.error.message);
            const out = await dispatchQuestionCommand({
              kind: "choice",
              qFlags: [parsed.data.instructions],
              contextsInline: parsed.data.contexts,
              name: parsed.data.name,
              concurrency: parsed.data.concurrency,
              optionFlags: Object.entries(parsed.data.options).map(
                ([k, v]) => `${k}=${v ?? ""}`,
              ),
              profile: parsed.data.profile,
            });
            return textResult(out);
          }
          if (kind === "score") {
            const parsed = FanScoreSchema.safeParse(args);
            if (!parsed.success) return invalid(parsed.error.message);
            const out = await dispatchQuestionCommand({
              kind: "score",
              qFlags: [parsed.data.instructions],
              contextsInline: parsed.data.contexts,
              name: parsed.data.name,
              concurrency: parsed.data.concurrency,
              levelFlags: parsed.data.levels.map((l) =>
                typeof l === "string" ? l : `${l.label}=${l.description ?? ""}`,
              ),
              profile: parsed.data.profile,
            });
            return textResult(out);
          }
          const parsed = FanYesNoSchema.safeParse(args);
          if (!parsed.success) return invalid(parsed.error.message);
          const out = await dispatchQuestionCommand({
            kind: "yesno",
            qFlags: [parsed.data.instructions],
            contextsInline: parsed.data.contexts,
            name: parsed.data.name,
            concurrency: parsed.data.concurrency,
            profile: parsed.data.profile,
          });
          return textResult(out);
        }

        if (kind === "choice") {
          const parsed = SingleChoiceSchema.safeParse(args);
          if (!parsed.success) return invalid(parsed.error.message);
          const out = await dispatchQuestionCommand({
            kind: "choice",
            qFlags: [parsed.data.instructions],
            stateInline: parsed.data.state,
            name: parsed.data.name,
            optionFlags: Object.entries(parsed.data.options).map(
              ([k, v]) => `${k}=${v ?? ""}`,
            ),
            profile: parsed.data.profile,
          });
          return textResult(out);
        }
        if (kind === "score") {
          const parsed = SingleScoreSchema.safeParse(args);
          if (!parsed.success) return invalid(parsed.error.message);
          const out = await dispatchQuestionCommand({
            kind: "score",
            qFlags: [parsed.data.instructions],
            stateInline: parsed.data.state,
            name: parsed.data.name,
            levelFlags: parsed.data.levels.map((l) =>
              typeof l === "string" ? l : `${l.label}=${l.description ?? ""}`,
            ),
            profile: parsed.data.profile,
          });
          return textResult(out);
        }

        const parsed = SingleYesNoSchema.safeParse(args);
        if (!parsed.success) return invalid(parsed.error.message);
        const out = await dispatchQuestionCommand({
          kind: "yesno",
          qFlags: [parsed.data.instructions],
          sFlag: JSON.stringify(parsed.data.state),
          name: parsed.data.name,
          profile: parsed.data.profile,
        });
        return textResult(out);
      }

      return invalid(`Unknown tool ${req.params.name}`);
    } catch (e) {
      const err =
        e instanceof RunnerError
          ? { ok: false, code: e.code, message: e.message }
          : { ok: false, code: "engine", message: String(e) };
      return textResult(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
