import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { resolveProfile, type DecideConfig } from "../src/config.js";
import { DIRECTORY_PIN_FILE } from "../src/repo-pin.js";
import { ProfilePinError } from "../src/errors.js";

const sample: DecideConfig = {
  active_profile: "jev",
  profiles: {
    jev: { engine: "typesafe", model: "jev-1.13.0" },
    openai: { engine: "openai", model: "gpt-6-luna" },
  },
};

describe("directory profile pin", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("uses pinned profile from parent directory", () => {
    root = join(tmpdir(), `decide-pin-${Date.now()}`);
    const child = join(root, "pkg", "src");
    mkdirSync(child, { recursive: true });
    writeFileSync(
      join(root, DIRECTORY_PIN_FILE),
      'profile = "openai"\nlock = false\n',
      "utf8",
    );
    const { name } = resolveProfile(sample, undefined, child);
    expect(name).toBe("openai");
  });

  it("rejects override when locked", () => {
    root = join(tmpdir(), `decide-lock-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, DIRECTORY_PIN_FILE), 'profile = "openai"\nlock = true\n', "utf8");
    expect(() => resolveProfile(sample, "jev", root)).toThrow(ProfilePinError);
  });
});
