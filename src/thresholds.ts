import type { Profile } from "./config.js";
import type { NormalizedAnswer, SuccessOutput } from "./types.js";

/** Apply optional per-profile thresholds (only when configured). */
export function applyThresholds(
  answers: Record<string, NormalizedAnswer>,
  profile: Profile,
): SuccessOutput["answers"] {
  const passAt = profile.thresholds?.yesno_pass;
  const out: SuccessOutput["answers"] = {};
  for (const [name, answer] of Object.entries(answers)) {
    if (answer.type === "yesno" && passAt !== undefined) {
      out[name] = { ...answer, pass: answer.p >= passAt };
    } else {
      out[name] = answer;
    }
  }
  return out;
}
