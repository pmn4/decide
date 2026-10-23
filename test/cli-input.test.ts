import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  looksLikeInlineJson,
  parseContextPair,
  parseInlineContextsJson,
  parseNameInstructionsPair,
  resolveContextsInput,
  resolveQuestionsInput,
  stripAtFilePrefix,
} from "../src/cli-input.js";
import { RunnerError } from "../src/errors.js";

describe("looksLikeInlineJson", () => {
  it("accepts leading bracket or brace only", () => {
    expect(looksLikeInlineJson('[{"name":"a","type":"yesno","instructions":"?"}]')).toBe(true);
    expect(looksLikeInlineJson('  {"questions":[]}  ')).toBe(true);
    expect(looksLikeInlineJson("@q.json")).toBe(false);
    expect(looksLikeInlineJson("q.json")).toBe(false);
  });
});

describe("stripAtFilePrefix", () => {
  it("removes leading @", () => {
    expect(stripAtFilePrefix("@/tmp/x.json")).toBe("/tmp/x.json");
    expect(stripAtFilePrefix("plain")).toBe("plain");
  });
});

describe("parseNameInstructionsPair", () => {
  it("parses name=instructions", () => {
    expect(parseNameInstructionsPair('urgent="Is it urgent?"')).toEqual({
      name: "urgent",
      instructions: '"Is it urgent?"',
    });
  });

  it("rejects missing parts", () => {
    expect(() => parseNameInstructionsPair("noinstr")).toThrow(RunnerError);
  });
});

describe("parseContextPair", () => {
  it("defaults id when omitted", () => {
    expect(parseContextPair("@ctx.txt")).toEqual({ source: "@ctx.txt" });
  });

  it("parses id=source", () => {
    expect(parseContextPair("a=@ctx.txt")).toEqual({ id: "a", source: "@ctx.txt" });
  });
});

describe("resolveQuestionsInput", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-cli-"));
  const qFile = join(dir, "qs.json");
  writeFileSync(
    qFile,
    JSON.stringify([{ name: "fromFile", type: "yesno", instructions: "File?" }]),
  );

  it("loads inline JSON array", async () => {
    const qs = await resolveQuestionsInput({
      kind: "yesno",
      questionsFlag: '[{"name":"inline","type":"yesno","instructions":"Inline?"}]',
      askPairs: [],
      optionFlags: [],
      levelFlags: [],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0].name).toBe("inline");
  });

  it("loads @file path", async () => {
    const qs = await resolveQuestionsInput({
      kind: "yesno",
      questionsFlag: `@${qFile}`,
      askPairs: [],
      optionFlags: [],
      levelFlags: [],
    });
    expect(qs[0].name).toBe("fromFile");
  });

  it("merges --ask with inline JSON", async () => {
    const qs = await resolveQuestionsInput({
      kind: "yesno",
      questionsFlag: '[{"name":"a","type":"yesno","instructions":"A?"}]',
      askPairs: ["b=B?"],
      optionFlags: [],
      levelFlags: [],
    });
    expect(qs.map((q) => q.name)).toEqual(["a", "b"]);
  });

  it("supports --questions with only --ask", async () => {
    const qs = await resolveQuestionsInput({
      kind: "yesno",
      questionsFlag: true,
      askPairs: ["x=X?"],
      optionFlags: [],
      levelFlags: [],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0].name).toBe("x");
  });

  it("rejects --ask without --questions flag", async () => {
    await expect(
      resolveQuestionsInput({
        kind: "yesno",
        questionsFlag: undefined,
        askPairs: ["x=X?"],
        optionFlags: [],
        levelFlags: [],
      }),
    ).rejects.toThrow(/requires --questions/);
  });
});

describe("resolveContextsInput", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-ctx-"));
  const jsonl = join(dir, "lines.jsonl");
  writeFileSync(
    jsonl,
    '{"id":"one","state":"alpha"}\n{"id":"two","state":"beta"}\n',
  );
  const ctxFile = join(dir, "body.txt");
  writeFileSync(ctxFile, "evidence from file");

  it("parses inline string array with default ids", async () => {
    const ctx = await parseInlineContextsJson('["first","second"]');
    expect(ctx.map((c) => c.id)).toEqual(["0", "1"]);
    expect(ctx[0].state).toBe("first");
  });

  it("resolves @file in inline object states", async () => {
    const ctx = await parseInlineContextsJson(
      `[{"id":"doc","state":"@${ctxFile.replace(/\\/g, "/")}"}]`,
    );
    expect(ctx[0].state).toBe("evidence from file");
  });

  it("loads JSONL via @file", async () => {
    const ctx = await resolveContextsInput({
      contextsFlag: `@${jsonl}`,
      contextPairs: [],
    });
    expect(ctx).toHaveLength(2);
    expect(ctx.find((c) => c.id === "one")?.state).toBe("alpha");
  });

  it("builds contexts from -c flags with default ids", async () => {
    const ctx = await resolveContextsInput({
      contextsFlag: true,
      contextPairs: ["hello", `@${ctxFile}`],
    });
    expect(ctx).toHaveLength(2);
    expect(ctx[0]).toEqual({ id: "0", state: "hello" });
    expect(ctx[1].id).toBe("1");
    expect(ctx[1].state).toBe("evidence from file");
  });

  it("merges inline JSON with -c entries", async () => {
    const ctx = await resolveContextsInput({
      contextsFlag: '["inline"]',
      contextPairs: ["extra=more"],
    });
    expect(ctx).toHaveLength(2);
    expect(ctx[0].state).toBe("inline");
    expect(ctx[1]).toEqual({ id: "extra", state: "more" });
  });
});
