import type { Question } from "./types.js";
import { parseKeyValuePairs, parseLevelPairs } from "./state.js";

export function buildSingleQuestion(
  kind: "yesno" | "choice" | "score",
  name: string,
  instructions: string,
  options: string[],
  levels: string[],
): Question {
  if (kind === "yesno") {
    return { name, type: "yesno", instructions };
  }
  if (kind === "choice") {
    const opts = parseKeyValuePairs(options);
    if (Object.keys(opts).length === 0) {
      throw new Error("choice requires at least one -o value=description");
    }
    return { name, type: "choice", instructions, options: opts };
  }
  const lv = parseLevelPairs(levels);
  if (lv.length < 2) {
    throw new Error("score requires at least two -l level entries");
  }
  return { name, type: "score", instructions, levels: lv };
}
