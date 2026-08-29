import { describe, expect, it } from "vitest";

import { resolveSelfHostCrons } from "./selfhost-crons";

describe("resolveSelfHostCrons", () => {
  it("disables scheduled triggers for a default Free-plan self-host", () => {
    expect(
      resolveSelfHostCrons("selfhost", ["*/5 * * * *", "17 3 * * *"], false),
    ).toEqual([]);
  });

  it("preserves schedules when self-host scheduling is explicitly enabled", () => {
    expect(
      resolveSelfHostCrons("selfhost", ["*/5 * * * *", "17 3 * * *"], true),
    ).toEqual(["*/5 * * * *", "17 3 * * *"]);
  });

  it("preserves schedules for non-self-host stages", () => {
    expect(
      resolveSelfHostCrons("preview", ["*/5 * * * *", "17 3 * * *"], false),
    ).toEqual(["*/5 * * * *", "17 3 * * *"]);
  });
});
