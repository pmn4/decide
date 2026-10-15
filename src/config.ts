import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import type { EngineId } from "./types.js";
import { findDirectoryPin } from "./repo-pin.js";
import { ProfilePinError, RunnerError } from "./errors.js";

const ThresholdsSchema = z.object({
  yesno_pass: z.number().min(0).max(1).optional(),
});

const ProfileSchema = z.object({
  engine: z.enum(["typesafe", "openai"]),
  model: z.string().min(1),
  concurrency: z.number().int().positive().optional(),
  thresholds: ThresholdsSchema.optional(),
});

const ConfigSchema = z.object({
  active_profile: z.string().min(1).optional(),
  concurrency: z.number().int().positive().optional(),
  request_timeout_ms: z.number().int().positive().optional(),
  profiles: z.record(ProfileSchema).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type DecideConfig = z.infer<typeof ConfigSchema>;

export function configDir(): string {
  return process.env.DECIDE_CONFIG_DIR ?? join(homedir(), ".config", "decide");
}

export function configPath(): string {
  return join(configDir(), "config.toml");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

const DEFAULT_CONFIG: DecideConfig = {
  active_profile: "jev",
  concurrency: 4,
  request_timeout_ms: 120_000,
  profiles: {
    jev: { engine: "typesafe", model: "jev-1.13.0" },
    openai: { engine: "openai", model: "gpt-6-luna" },
  },
};

export function loadConfig(): DecideConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG, profiles: { ...DEFAULT_CONFIG.profiles } };
  }
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config at ${path}: ${parsed.error.message}`);
  }
  const cfg = parsed.data;
  if (Object.keys(cfg.profiles).length === 0) {
    return { ...DEFAULT_CONFIG, profiles: { ...DEFAULT_CONFIG.profiles } };
  }
  return cfg;
}

export function saveConfig(config: DecideConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), stringify(config as Record<string, unknown>), "utf8");
}

export function profileEnvVar(profileName: string): string {
  const normalized = profileName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `DECIDE_${normalized}_API_KEY`;
}

export function resolveProfile(
  config: DecideConfig,
  cliProfile?: string,
  cwd: string = process.cwd(),
): { name: string; profile: Profile } {
  const envProfile = process.env.DECIDE_PROFILE;
  const requested = cliProfile ?? envProfile;

  const found = findDirectoryPin(cwd);
  if (found?.pin.lock) {
    if (requested && requested !== found.pin.profile) {
      throw new ProfilePinError(
        `Profile is locked to "${found.pin.profile}" by ${found.path} (remove lock or use that profile).`,
      );
    }
    const profile = config.profiles[found.pin.profile];
    if (!profile) {
      throw new ProfilePinError(
        `Locked profile "${found.pin.profile}" in ${found.path} is not defined in config.`,
      );
    }
    return { name: found.pin.profile, profile };
  }

  const name =
    requested ??
    found?.pin.profile ??
    config.active_profile ??
    "jev";
  const profile = config.profiles[name];
  if (!profile) {
    throw new ProfileError(`Unknown profile "${name}". Run \`decide profile list\`.`);
  }
  return { name, profile };
}

export function profileConcurrency(config: DecideConfig, profileName: string): number {
  const profile = config.profiles[profileName];
  return profile?.concurrency ?? config.concurrency ?? 4;
}

export function requestTimeoutMs(config: DecideConfig): number {
  return config.request_timeout_ms ?? 120_000;
}

export class ProfileError extends RunnerError {
  constructor(message: string) {
    super("invalid", message);
  }
}

export function engineEnvVar(engine: EngineId): string {
  return engine === "typesafe" ? "TYPESAFE_API_KEY" : "OPENAI_API_KEY";
}
