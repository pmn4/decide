import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createProfileAuth } from "../src/auth.js";

describe("createProfileAuth key order", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("prefers DECIDE_<PROFILE>_API_KEY over engine env", async () => {
    process.env.DECIDE_JEV_API_KEY = "profile-key";
    process.env.TYPESAFE_API_KEY = "engine-key";
    const auth = createProfileAuth("jev", "typesafe");
    expect(await auth.getApiKey()).toBe("profile-key");
  });
});
