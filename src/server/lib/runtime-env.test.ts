import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock cloudflare:workers so getOptionalEnvValue can resolve bindings without
// a real Workers runtime.
vi.mock("cloudflare:workers", () => ({
  env: {} as Record<string, unknown>,
}));

import { env as workersEnv } from "cloudflare:workers";
import {
  _resetSecretCache,
  getEnvValueSync,
  getOptionalEnvValue,
} from "@/server/lib/runtime-env";

describe("getOptionalEnvValue", () => {
  beforeEach(() => {
    // Reset the workers env and any cached state between tests by clearing
    // all keys.
    for (const key of Object.keys(workersEnv)) delete workersEnv[key];
    _resetSecretCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the string when the binding is a plain string", async () => {
    workersEnv.FOO = "plain-value";
    await expect(getOptionalEnvValue("FOO")).resolves.toBe("plain-value");
  });

  it("resolves a Secrets Store binding via get()", async () => {
    const get = vi.fn(async () => "secret-value");
    workersEnv.FOO = { get };
    await expect(getOptionalEnvValue("FOO")).resolves.toBe("secret-value");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when get() resolves to an empty string", async () => {
    workersEnv.FOO = { get: async () => "" };
    await expect(getOptionalEnvValue("FOO")).resolves.toBeUndefined();
  });

  it("returns undefined and does not throw when get() rejects", async () => {
    workersEnv.FOO = { get: async () => {
      throw new Error("boom");
    } };
    await expect(getOptionalEnvValue("FOO")).resolves.toBeUndefined();
  });

  it("process.env wins over the binding", async () => {
    const original = process.env.FOO;
    process.env.FOO = "from-process";
    workersEnv.FOO = { get: async () => "from-binding" };
    try {
      await expect(getOptionalEnvValue("FOO")).resolves.toBe("from-process");
    } finally {
      if (original === undefined) delete process.env.FOO;
      else process.env.FOO = original;
    }
  });

  it("calls get() only once within the TTL", async () => {
    const get = vi.fn(async () => "cached-value");
    workersEnv.FOO = { get };
    await getOptionalEnvValue("FOO");
    await getOptionalEnvValue("FOO");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("calls get() again after the TTL expires", async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => "cached-value");
    workersEnv.FOO = { get };
    await getOptionalEnvValue("FOO");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await getOptionalEnvValue("FOO");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed get()", async () => {
    let calls = 0;
    workersEnv.FOO = {
      get: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return "ok";
      },
    };
    await expect(getOptionalEnvValue("FOO")).resolves.toBeUndefined();
    await expect(getOptionalEnvValue("FOO")).resolves.toBe("ok");
  });
});

describe("getEnvValueSync", () => {
  it("returns undefined for an empty string binding", () => {
    expect(getEnvValueSync({ FOO: "" }, "FOO")).toBeUndefined();
  });

  it("returns the value for a non-empty string binding", () => {
    expect(getEnvValueSync({ FOO: "bar" }, "FOO")).toBe("bar");
  });

  it("process.env wins over the binding", () => {
    const original = process.env.FOO;
    process.env.FOO = "from-process";
    try {
      expect(getEnvValueSync({ FOO: "from-binding" }, "FOO")).toBe(
        "from-process",
      );
    } finally {
      if (original === undefined) delete process.env.FOO;
      else process.env.FOO = original;
    }
  });

  it("returns undefined for a Secrets Store binding", () => {
    const binding = { get: async () => "value" };
    expect(getEnvValueSync({ FOO: binding }, "FOO")).toBeUndefined();
  });
});
