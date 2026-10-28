import { describe, expect, it } from "vitest";
import {
  assertOk,
  DataforseoChargedTaskError,
} from "@/server/lib/dataforseo/envelope";

describe("DataForSEO account billing task failures", () => {
  it("surfaces a billing restriction without metering failed tasks", () => {
    for (const status of [40200, 40203, 40204, 40210]) {
      const task = {
        status_code: status,
        status_message: "Account billing restriction",
        path: ["v3", "dataforseo_labs", "google"],
        cost: 0.02,
        result_count: 0,
      };
      try {
        assertOk({ status_code: 20000, tasks: [task] });
        throw new Error("Expected billing restriction");
      } catch (error) {
        expect(error).not.toBeInstanceOf(DataforseoChargedTaskError);
        expect(error).toMatchObject({ code: "DATAFORSEO_BILLING_ISSUE" });
      }
    }
  });
});
