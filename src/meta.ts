import type { Profile } from "./config.js";
import { applyThresholds } from "./thresholds.js";
import type { EngineId, NormalizedAnswer, SuccessOutput } from "./types.js";
import { SuccessOutputSchema } from "./types.js";

export interface StampFields {
  profileName: string;
  engine: EngineId;
  model: string;
  profile: Profile;
}

export function buildSuccessOutput(
  stamp: StampFields,
  answers: Record<string, NormalizedAnswer>,
  usage: { input_tokens?: number; [key: string]: unknown },
  latency_ms: number,
): SuccessOutput {
  const out: SuccessOutput = {
    ok: true,
    profile: stamp.profileName,
    engine: stamp.engine,
    model: stamp.model,
    answers: applyThresholds(answers, stamp.profile),
    usage,
    latency_ms,
  };
  SuccessOutputSchema.parse(out);
  return out;
}
