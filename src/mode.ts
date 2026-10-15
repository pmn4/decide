import { RunnerError } from "./errors.js";

/** Batch/fan switches are explicit; never infer from input shape. */
export function validateQuestionCommandMode(opts: {
  command: "yesno" | "choice" | "score";
  qCount: number;
  sCount: number;
  questionsSwitch?: string;
  contextsSwitch?: string;
}): "single" | "multi_questions" | "multi_contexts" {
  const hasQuestions = Boolean(opts.questionsSwitch);
  const hasContexts = Boolean(opts.contextsSwitch);

  if (hasQuestions && hasContexts) {
    throw new RunnerError(
      "invalid",
      "Use either --questions (many questions, one -s context) or --contexts (one question, many contexts), not both.",
    );
  }

  if (opts.qCount > 1 && !hasQuestions) {
    throw new RunnerError(
      "invalid",
      `Multiple -q flags require --questions <file|->. For one question, pass a single -q.`,
    );
  }

  if (opts.sCount > 1) {
    throw new RunnerError("invalid", "Only one -s context is allowed.");
  }

  if (hasContexts) {
    if (opts.qCount !== 1) {
      throw new RunnerError(
        "invalid",
        `--contexts requires exactly one -q (the question applied to each context).`,
      );
    }
    if (!hasQuestions) {
      return "multi_contexts";
    }
  }

  if (hasQuestions) {
    if (opts.qCount > 0) {
      throw new RunnerError(
        "invalid",
        `With --questions, put questions in the file (not -q). Use -s for the shared context only.`,
      );
    }
    if (opts.sCount !== 1) {
      throw new RunnerError("invalid", "--questions requires exactly one -s shared context.");
    }
    return "multi_questions";
  }

  if (opts.qCount !== 1) {
    throw new RunnerError(
      "invalid",
      `${opts.command} requires exactly one -q, or --questions / --contexts for batch patterns.`,
    );
  }

  if (opts.sCount !== 1 && !hasContexts) {
    throw new RunnerError("invalid", `${opts.command} requires -s <state|@file|-> for the context.`);
  }

  return "single";
}
