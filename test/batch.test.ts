import { describe, expect, it } from "vitest";
import { splitQuestionChunks } from "../src/batch.js";
import { typesafeAdapter } from "../src/engines/index.js";
import type { Question } from "../src/types.js";

describe("splitQuestionChunks", () => {
  it("keeps small batches in one chunk", () => {
    const qs: Question[] = [
      { name: "a", type: "yesno", instructions: "A?" },
      { name: "b", type: "yesno", instructions: "B?" },
    ];
    const chunks = splitQuestionChunks(typesafeAdapter, "state", "jev-1.13.0", qs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it("splits when question count exceeds max", () => {
    const qs: Question[] = Array.from({ length: 130 }, (_, i) => ({
      name: `q${i}`,
      type: "yesno" as const,
      instructions: `Question ${i}?`,
    }));
    const chunks = splitQuestionChunks(typesafeAdapter, "x".repeat(100), "jev-1.13.0", qs);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(130);
  });
});
