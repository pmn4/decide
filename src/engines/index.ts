import type { EngineId } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { typesafeAdapter } from "./typesafe.js";
import { openaiAdapter } from "./openai.js";

const adapters: Record<EngineId, EngineAdapter> = {
  typesafe: typesafeAdapter,
  openai: openaiAdapter,
};

export function getEngineAdapter(engine: EngineId): EngineAdapter {
  return adapters[engine];
}

export { typesafeAdapter, openaiAdapter };
export * from "./types.js";
