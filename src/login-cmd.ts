import * as p from "@clack/prompts";
import { createProfileAuth, isInteractive } from "./auth.js";
import { loadConfig, resolveProfile, engineEnvVar, profileEnvVar } from "./config.js";
import type { EngineId } from "./types.js";
import { RunnerError } from "./errors.js";

const ENGINE_LABEL: Record<EngineId, string> = {
  typesafe: "TypeSafe (Jev)",
  openai: "OpenAI Decisions",
};

export async function cmdLogin(engineArg?: string, profileName?: string): Promise<void> {
  if (!isInteractive()) {
    throw new RunnerError(
      "invalid",
      "decide login requires an interactive terminal. Set DECIDE_<PROFILE>_API_KEY or the engine API key env var instead.",
    );
  }

  const config = loadConfig();
  const { name, profile } = resolveProfile(config, profileName);
  let engine: EngineId = profile.engine;
  if (engineArg) {
    if (engineArg !== "typesafe" && engineArg !== "openai") {
      throw new RunnerError("invalid", `Unknown engine "${engineArg}". Use typesafe or openai.`);
    }
    engine = engineArg;
  }

  p.intro(`decide login — profile "${name}" (${ENGINE_LABEL[engine]})`);
  const key = await p.password({
    message: `API key (stored for profile; env: ${profileEnvVar(name)} or ${engineEnvVar(engine)})`,
    validate: (v) => (v && v.length > 0 ? undefined : "Key required"),
  });
  if (p.isCancel(key)) {
    p.cancel("Login cancelled.");
    process.exit(1);
  }
  await createProfileAuth(name, engine).setApiKey(key as string);
  p.outro("API key stored in OS keychain (or ~/.config/decide/credentials.json).");
}

export async function cmdLogout(_engineArg?: string, profileName?: string): Promise<void> {
  const config = loadConfig();
  const { name, profile } = resolveProfile(config, profileName);
  await createProfileAuth(name, profile.engine).deleteApiKey();
  console.log(`Removed stored key for profile "${name}".`);
}
