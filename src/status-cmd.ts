import { hasStoredKey, keySourceLabel } from "./auth.js";
import { loadConfig, resolveProfile, engineEnvVar, profileEnvVar } from "./config.js";
import { runDecision, RunnerError } from "./runner.js";
import { findDirectoryPin } from "./repo-pin.js";

export async function cmdStatus(profileName?: string, json?: boolean): Promise<void> {
  const config = loadConfig();
  const { name, profile } = resolveProfile(config, profileName);
  const profileVar = profileEnvVar(name);
  const engineVar = engineEnvVar(profile.engine);
  const profileEnv = Boolean(process.env[profileVar]);
  const engineEnv = Boolean(process.env[engineVar]);
  const stored = await hasStoredKey(name, profile.engine);
  const pin = findDirectoryPin();

  let live: { ok: boolean; latency_ms?: number; message?: string; skipped?: boolean } = {
    ok: false,
  };

  if (process.env.DECIDE_STATUS_SKIP === "1" || process.env.DECIDE_STATUS_SKIP === "true") {
    live = { ok: false, skipped: true, message: "Skipped (DECIDE_STATUS_SKIP)" };
  } else if (profileEnv || engineEnv || stored) {
    try {
      const res = await runDecision("ping", [
        { name: "alive", type: "yesno", instructions: "Is this a connectivity check?" },
      ], { profile: name });
      live = { ok: true, latency_ms: res.latency_ms };
    } catch (e) {
      live = {
        ok: false,
        message: e instanceof RunnerError ? e.message : String(e),
      };
    }
  } else {
    live = { ok: false, message: "No API key configured" };
  }

  const payload = {
    profile: name,
    engine: profile.engine,
    model: profile.model,
    directory_pin: pin ? { path: pin.path, profile: pin.pin.profile, lock: pin.pin.lock } : null,
    key: {
      profile_env: profileEnv,
      engine_env: engineEnv,
      stored,
      resolution_hint: keySourceLabel(name, profile.engine),
    },
    live_test: live,
  };

  if (json || !process.stdout.isTTY) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Profile:  ${name}`);
    console.log(`Engine:   ${profile.engine}`);
    console.log(`Model:    ${profile.model}`);
    if (pin) {
      console.log(`Pin:      ${pin.path} → ${pin.pin.profile}${pin.pin.lock ? " (locked)" : ""}`);
    }
    console.log(
      `API key:  ${
        profileEnv
          ? `yes (${profileVar})`
          : engineEnv
            ? `yes (${engineVar})`
            : stored
              ? "yes (keychain/file)"
              : "no"
      }`,
    );
    console.log(
      `Live:     ${
        live.skipped
          ? "skipped"
          : live.ok
            ? `ok (${live.latency_ms}ms)`
            : `failed — ${live.message}`
      }`,
    );
  }
}
