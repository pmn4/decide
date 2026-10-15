import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openaiAdapter, typesafeAdapter } from "../src/engines/index.js";
import type { Question } from "../src/types.js";

const fixtures = join(import.meta.dirname, "fixtures");

const questions: Question[] = [
  { name: "is_urgent", type: "yesno", instructions: "Urgent?" },
  {
    name: "department",
    type: "choice",
    instructions: "Team?",
    options: { billing: "pay", technical: "bugs" },
  },
  {
    name: "frustration",
    type: "score",
    instructions: "How frustrated?",
    levels: ["Calm", "Frustrated", "Very angry"],
  },
];

describe("typesafe adapter", () => {
  it("maps request body to noul/choice/score", () => {
    const body = typesafeAdapter.buildRequest("hello", "jev-1.13.0", questions) as {
      questions: Record<string, { type: string }>;
    };
    expect(body.questions.is_urgent.type).toBe("noul");
    expect(body.questions.department.type).toBe("choice");
    expect(body.questions.frustration.type).toBe("score");
  });

  it("maps response fixture", () => {
    const raw = JSON.parse(readFileSync(join(fixtures, "typesafe-response.json"), "utf8"));
    const out = typesafeAdapter.mapResponse(raw, questions);
    expect(out.answers.is_urgent).toEqual({ type: "yesno", p: 0.95 });
    expect(out.answers.department.type).toBe("choice");
    expect(out.usage.input_tokens).toBe(296);
  });
});

describe("openai adapter", () => {
  it("maps predicate/choice/score questions", () => {
    const body = openaiAdapter.buildRequest("hello", "gpt-6-luna", questions) as {
      questions: Array<{ type: string; name: string }>;
    };
    expect(body.questions[0].type).toBe("predicate");
    expect(body.questions[1].type).toBe("choice");
    expect(body.questions[2].type).toBe("score");
  });

  it("maps response fixture", () => {
    const openaiQs: Question[] = [
      { name: "visible_damage", type: "yesno", instructions: "damage?" },
      {
        name: "department",
        type: "choice",
        instructions: "dept",
        options: { billing: "a", technical: "b" },
      },
      {
        name: "severity",
        type: "score",
        instructions: "sev",
        levels: ["Cosmetic", "Workaround", "Blocked"],
      },
    ];
    const raw = JSON.parse(readFileSync(join(fixtures, "openai-response.json"), "utf8"));
    const out = openaiAdapter.mapResponse(raw, openaiQs);
    expect(out.answers.visible_damage).toEqual({ type: "yesno", p: 0.92 });
    expect(out.answers.department).toMatchObject({ type: "choice", value: "billing" });
  });
});
