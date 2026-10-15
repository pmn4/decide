import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { credentialsPath, configDir, engineEnvVar, profileEnvVar } from "./config.js";
import type { EngineId } from "./types.js";

/** Future: browser OAuth (e.g. Azure Entra) plugs in here per engine. */
export interface OAuthSlot {
  login?(): Promise<void>;
  logout?(): Promise<void>;
}

export interface ProfileAuth {
  profileName: string;
  engine: EngineId;
  oauth?: OAuthSlot;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
}

type CredentialFile = {
  profiles?: Record<string, string>;
  /** Legacy per-engine storage (still read as fallback). */
  engines?: Partial<Record<EngineId, string>>;
};

function readCredentialFile(): CredentialFile {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CredentialFile;
  } catch {
    return {};
  }
}

function writeCredentialFile(data: CredentialFile): void {
  mkdirSync(configDir(), { recursive: true });
  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  chmodSync(path, 0o600);
}

async function keyringGet(service: string, account: string): Promise<string | null> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(service, account);
    const password = await entry.getPassword();
    return password ?? null;
  } catch {
    return null;
  }
}

async function keyringSet(service: string, account: string, password: string): Promise<boolean> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(service, account);
    await entry.setPassword(password);
    return true;
  } catch {
    return false;
  }
}

async function keyringDelete(service: string, account: string): Promise<boolean> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(service, account);
    await entry.deletePassword();
    return true;
  } catch {
    return false;
  }
}

const KEYRING_SERVICE = "decide-cli";

function accountForProfile(profileName: string): string {
  return `profile-${profileName}`;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

export function createProfileAuth(profileName: string, engine: EngineId): ProfileAuth {
  return {
    profileName,
    engine,
    oauth: {},
    async getApiKey() {
      const profileVar = profileEnvVar(profileName);
      if (process.env[profileVar]) {
        return process.env[profileVar]!;
      }
      const engineVar = engineEnvVar(engine);
      if (process.env[engineVar]) {
        return process.env[engineVar]!;
      }
      const fromRing = await keyringGet(KEYRING_SERVICE, accountForProfile(profileName));
      if (fromRing) return fromRing;
      const file = readCredentialFile();
      if (file.profiles?.[profileName]) {
        return file.profiles[profileName];
      }
      if (file.engines?.[engine]) {
        return file.engines[engine];
      }
      return null;
    },
    async setApiKey(key: string) {
      const stored = await keyringSet(KEYRING_SERVICE, accountForProfile(profileName), key);
      if (!stored) {
        const file = readCredentialFile();
        file.profiles = file.profiles ?? {};
        file.profiles[profileName] = key;
        writeCredentialFile(file);
      }
    },
    async deleteApiKey() {
      await keyringDelete(KEYRING_SERVICE, accountForProfile(profileName));
      const file = readCredentialFile();
      if (file.profiles) {
        delete file.profiles[profileName];
      }
      if (file.profiles && Object.keys(file.profiles).length === 0) {
        delete file.profiles;
      }
      if (!file.profiles && !file.engines) {
        const path = credentialsPath();
        if (existsSync(path)) unlinkSync(path);
      } else {
        writeCredentialFile(file);
      }
    },
  };
}

export async function hasStoredKey(profileName: string, engine: EngineId): Promise<boolean> {
  const auth = createProfileAuth(profileName, engine);
  const key = await auth.getApiKey();
  return Boolean(key && key.length > 0);
}

export function keySourceLabel(profileName: string, engine: EngineId): string {
  if (process.env[profileEnvVar(profileName)]) return profileEnvVar(profileName);
  if (process.env[engineEnvVar(engine)]) return engineEnvVar(engine);
  return "keychain or credentials file";
}
