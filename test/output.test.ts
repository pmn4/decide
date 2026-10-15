import { describe, expect, it } from "vitest";
import { SuccessOutputSchema } from "../src/types.js";

describe("SuccessOutputSchema", () => {
  it("accepts stamped success payload with outcomes", () => {
    const payload = {
      ok: true,
      profile: "jev",
      engine: "typesafe",
      model: "jev-1.13.0",
      answers: {
        q: { type: "yesno", p: 0.5, pass: true },
        r: { type: "refusal", reason: "policy" },
      },
      usage: { input_tokens: 10, request_chunks: 2 },
      latency_ms: 3,
    };
    expect(SuccessOutputSchema.safeParse(payload).success).toBe(true);
  });
});
