import { describe, expect, it } from "vitest";
import { validateQuestionCommandMode } from "../src/mode.js";
import { RunnerError } from "../src/errors.js";

describe("validateQuestionCommandMode", () => {
  it("defaults to single", () => {
    expect(
      validateQuestionCommandMode({
        command: "yesno",
        qCount: 1,
        sCount: 1,
      }),
    ).toBe("single");
  });

  it("rejects both switches", () => {
    expect(() =>
      validateQuestionCommandMode({
        command: "yesno",
        qCount: 0,
        sCount: 1,
        questionsSwitch: "f",
        contextsSwitch: "c",
      }),
    ).toThrow(RunnerError);
  });

  it("rejects multiple -q without --questions", () => {
    expect(() =>
      validateQuestionCommandMode({
        command: "choice",
        qCount: 2,
        sCount: 1,
      }),
    ).toThrow(/Multiple -q/);
  });

  it("selects multi_questions", () => {
    expect(
      validateQuestionCommandMode({
        command: "yesno",
        qCount: 0,
        sCount: 1,
        questionsSwitch: "q.json",
      }),
    ).toBe("multi_questions");
  });

  it("selects multi_contexts", () => {
    expect(
      validateQuestionCommandMode({
        command: "score",
        qCount: 1,
        sCount: 0,
        contextsSwitch: "c.jsonl",
      }),
    ).toBe("multi_contexts");
  });
});
