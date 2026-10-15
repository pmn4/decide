import { describe, expect, it } from "vitest";
import { resolveProfile, profileEnvVar, type DecideConfig } from "../src/config.js";

const sample: DecideConfig = {
  active_profile: "jev",
  profiles: {
    jev: { engine: "typesafe", model: "jev-1.13.0" },
    openai: { engine: "openai", model: "gpt-6-luna" },
  },
};

describe("resolveProfile", () => {
  it("uses cli override when not locked", () => {
    const { name, profile } = resolveProfile(sample, "openai", "/tmp");
    expect(name).toBe("openai");
    expect(profile.engine).toBe("openai");
  });

  it("falls back to active profile", () => {
    const { name } = resolveProfile(sample, undefined, "/tmp");
    expect(name).toBe("jev");
  });
});

describe("profileEnvVar", () => {
  it("normalizes profile names", () => {
    expect(profileEnvVar("my-profile")).toBe("DECIDE_MY_PROFILE_API_KEY");
  });
});
