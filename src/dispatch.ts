import type { FanContext } from "./batch.js";
import { loadConfig, profileConcurrency, resolveProfile } from "./config.js";
import { validateQuestionCommandMode } from "./mode.js";
import { buildSingleQuestion } from "./questions.js";
import { resolveState } from "./state.js";
import { runDecision, runFanDecision, RunnerError } from "./runner.js";
import type { Question } from "./types.js";

export interface QuestionCommandInput {
  kind: "yesno" | "choice" | "score";
  qFlags: string[];
  sFlag?: string;
  stateInline?: unknown;
  questionsInline?: Question[];
  contextsInline?: FanContext[];
  name?: string;
  concurrency?: number;
  optionFlags?: string[];
  levelFlags?: string[];
  profile?: string;
}

export async function dispatchQuestionCommand(input: QuestionCommandInput) {
  const config = loadConfig();
  const hasQuestionsSwitch = Boolean(input.questionsInline);
  const hasContextsSwitch = Boolean(input.contextsInline);

  const mode = validateQuestionCommandMode({
    command: input.kind,
    qCount: input.qFlags.length,
    sCount: input.sFlag || input.stateInline !== undefined ? 1 : 0,
    questionsSwitch: hasQuestionsSwitch ? "1" : undefined,
    contextsSwitch: hasContextsSwitch ? "1" : undefined,
  });

  const questionName = input.name ?? "q";

  if (mode === "multi_questions") {
    const questions = input.questionsInline!;
    const state =
      input.stateInline ?? (input.sFlag ? await resolveState(input.sFlag) : undefined);
    if (state === undefined) {
      throw new RunnerError("invalid", "--questions requires -s <shared context>.");
    }
    return runDecision(state, questions, { profile: input.profile });
  }

  if (mode === "multi_contexts") {
    const instructions = input.qFlags[0];
    let question: Question;
    try {
      question = buildSingleQuestion(
        input.kind,
        questionName,
        instructions,
        input.optionFlags ?? [],
        input.levelFlags ?? [],
      );
    } catch (e) {
      throw new RunnerError("invalid", e instanceof Error ? e.message : String(e));
    }
    const contexts = input.contextsInline!;
    const { name } = resolveProfile(config, input.profile);
    const concurrency = input.concurrency ?? profileConcurrency(config, name);
    return runFanDecision(question, contexts, concurrency, {
      profile: input.profile,
    });
  }

  const instructions = input.qFlags[0];
  let question: Question;
  try {
    question = buildSingleQuestion(
      input.kind,
      questionName,
      instructions,
      input.optionFlags ?? [],
      input.levelFlags ?? [],
    );
  } catch (e) {
    throw new RunnerError("invalid", e instanceof Error ? e.message : String(e));
  }
  const state =
    input.stateInline ?? (input.sFlag ? await resolveState(input.sFlag) : undefined);
  if (state === undefined) {
    throw new RunnerError("invalid", `${input.kind} requires -s <context>.`);
  }
  return runDecision(state, [question], { profile: input.profile });
}
