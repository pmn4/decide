import { loadConfig, saveConfig } from "./config.js";

export function cmdProfileList(json?: boolean): void {
  const config = loadConfig();
  const payload = {
    active: config.active_profile,
    profiles: Object.keys(config.profiles),
  };
  if (json || !process.stdout.isTTY) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Active: ${config.active_profile}`);
    for (const p of payload.profiles) {
      const mark = p === config.active_profile ? "*" : " ";
      console.log(`${mark} ${p} (${config.profiles[p].engine}, ${config.profiles[p].model})`);
    }
  }
}

export function cmdProfileUse(name: string): void {
  const config = loadConfig();
  if (!config.profiles[name]) {
    throw new Error(`Unknown profile "${name}"`);
  }
  config.active_profile = name;
  saveConfig(config);
  console.log(`Active profile set to "${name}".`);
}
