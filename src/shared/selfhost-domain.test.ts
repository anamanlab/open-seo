import { describe, expect, it } from "vitest";
import {
  parseSelfHostDomain,
  resolveSelfHostHostname,
} from "./selfhost-domain";

describe("self-host domain configuration", () => {
  it("normalizes a configured custom hostname", () => {
    expect(parseSelfHostDomain(" SEO.Optvoo.com ")).toBe("seo.optvoo.com");
  });

  it("rejects URLs instead of accepting a path or protocol", () => {
    expect(() => parseSelfHostDomain("https://seo.optvoo.com/app")).toThrow(
      "SELF_HOST_DOMAIN must be a hostname",
    );
  });

  it("allows the deployment to fall back to its workers.dev hostname", () => {
    expect(
      resolveSelfHostHostname("", "open-seo-selfhost.example.workers.dev"),
    ).toBe("open-seo-selfhost.example.workers.dev");
    expect(
      resolveSelfHostHostname(
        "seo.optvoo.com",
        "open-seo-selfhost.example.workers.dev",
      ),
    ).toBe("seo.optvoo.com");
  });
});
