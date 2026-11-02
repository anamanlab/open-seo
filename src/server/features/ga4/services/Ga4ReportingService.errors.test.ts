import { describe, expect, it, vi } from "vitest";
import { Ga4DataApiError, Ga4TokenError } from "@/server/lib/ga4Errors";
import { mapGa4ReportError } from "./Ga4ReportingService";

vi.mock("@/server/features/ga4/repositories/Ga4ConnectionRepository", () => ({
  Ga4ConnectionRepository: {},
}));
vi.mock("@/server/lib/ga4Client", () => ({ createGa4DataClient: vi.fn() }));

describe("Google Analytics token error classification", () => {
  it("does not infer revoked consent from an opaque token failure", () => {
    expect.assertions(1);
    try {
      mapGa4ReportError(new Ga4TokenError("sensitive upstream detail"));
    } catch (error) {
      expect(error).toMatchObject({
        code: "ga4_token_unavailable",
        message:
          "Could not obtain a Google Analytics access token. Check the connection and server OAuth configuration.",
      });
    }
  });

  it("still requests reconnect when Google rejects authorization with 401", () => {
    expect.assertions(1);
    try {
      mapGa4ReportError(new Ga4DataApiError(401, "rejected"));
    } catch (error) {
      expect(error).toMatchObject({ code: "ga4_reconnect_required" });
    }
  });
});
