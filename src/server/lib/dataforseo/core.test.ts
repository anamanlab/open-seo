import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn().mockResolvedValue("encoded-credentials"),
}));

import { onPageApi } from "@/server/lib/dataforseo/core";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSEO OnPage transport", () => {
  it("reports HTTP 402 as a billing error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Payment required", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(onPageApi().lighthouseLiveJson([])).rejects.toMatchObject({
      code: "DATAFORSEO_BILLING_ISSUE",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a Lighthouse HTTP 5xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream failure", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(onPageApi().lighthouseLiveJson([])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
