import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ga4AdminApiError, Ga4TokenError } from "@/server/lib/ga4Errors";
import { Ga4Service } from "./Ga4Service";

const mocks = vi.hoisted(() => {
  const state: {
    grants: Array<{
      id: string;
      accountId: string;
      refreshTokenExpiresAt?: Date | null;
    }>;
  } = {
    grants: [],
  };
  const listProperties = vi.fn();
  const getProperty = vi.fn();
  const getUserInfoEmail = vi.fn();
  return {
    state,
    dbDelete: vi.fn(),
    listProperties,
    getProperty,
    getUserInfoEmail,
    createGa4AdminClient: vi.fn(() => ({
      listProperties,
      getProperty,
      getUserInfoEmail,
    })),
    dbSelect: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = state.grants.map((row) => ({
            refreshTokenExpiresAt: null,
            ...row,
          }));
          return Object.assign(Promise.resolve(rows), {
            limit: vi.fn().mockResolvedValue(rows),
          });
        }),
      })),
    })),
    upsert: vi.fn(),
    getByProjectId: vi.fn(),
  };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: { select: mocks.dbSelect, delete: mocks.dbDelete },
}));
vi.mock("@/server/lib/ga4Client", () => ({
  createGa4AdminClient: mocks.createGa4AdminClient,
}));
vi.mock("@/server/features/ga4/repositories/Ga4ConnectionRepository", () => ({
  Ga4ConnectionRepository: {
    upsert: mocks.upsert,
    getByProjectId: mocks.getByProjectId,
  },
}));

describe("Ga4Service", () => {
  beforeEach(() => {
    mocks.state.grants = [{ id: "grant-a", accountId: "sub-a" }];
  });

  it("verifies a freshly discovered property before persisting metadata", async () => {
    mocks.listProperties.mockResolvedValue([
      {
        propertyId: "properties/11",
        displayName: "Site A",
        accountDisplayName: "Agency",
      },
    ]);
    mocks.getProperty.mockResolvedValue({
      name: "properties/11",
      displayName: "Site A",
      timeZone: "America/New_York",
      currencyCode: "USD",
    });
    mocks.getUserInfoEmail.mockResolvedValue("client@example.com");
    mocks.upsert.mockResolvedValue({ propertyId: "properties/11" });
    const input = {
      projectId: "p1",
      organizationId: "org1",
      propertyId: "properties/11",
      accountId: "sub-a",
      userId: "u1",
    };

    await Ga4Service.setProperty(input);

    expect(mocks.upsert).toHaveBeenCalledWith({
      projectId: "p1",
      organizationId: "org1",
      propertyId: "properties/11",
      propertyDisplayName: "Site A",
      propertyTimeZone: "America/New_York",
      propertyCurrencyCode: "USD",
      connectedByUserId: "u1",
      ga4AccountId: "sub-a",
      connectedAccountEmail: "client@example.com",
    });

    // A userinfo failure is non-fatal: the email is passed through as null.
    mocks.getUserInfoEmail.mockRejectedValue(new Error("userinfo unavailable"));
    await Ga4Service.setProperty(input);
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectedAccountEmail: null }),
    );
  });

  it("rejects a property or connector the current user does not own", async () => {
    await expect(
      Ga4Service.setProperty({
        projectId: "p1",
        organizationId: "org1",
        propertyId: "properties/11",
        accountId: "foreign-sub",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    mocks.listProperties.mockResolvedValue([]);
    await expect(
      Ga4Service.setProperty({
        projectId: "p1",
        organizationId: "org1",
        propertyId: "properties/11",
        accountId: "sub-a",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { expiry: new Date("2026-10-29T00:00:00Z"), reconnect: true },
    { expiry: new Date("2026-11-02T12:00:00Z"), reconnect: true },
    { expiry: new Date("2026-11-09T00:00:00Z"), reconnect: false },
    { expiry: null, reconnect: false },
  ])(
    "uses recorded refresh expiry $expiry only after token acquisition fails",
    async ({ expiry, reconnect }) => {
      vi.spyOn(Date, "now").mockReturnValue(
        new Date("2026-11-02T12:00:00Z").getTime(),
      );
      mocks.state.grants = [
        { id: "grant-a", accountId: "sub-a", refreshTokenExpiresAt: expiry },
      ];
      mocks.listProperties.mockRejectedValue(
        new Ga4TokenError("token unavailable"),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result =
        await Ga4Service.listPropertiesForUserWithGrantStatus("u1");
      expect(result.accounts[0]).toMatchObject({
        requiresReconnect: reconnect,
        propertiesUnavailable: !reconnect,
      });
      expect(mocks.dbDelete).not.toHaveBeenCalled();
    },
  );

  it("keeps successful discovery usable even after recorded refresh expiry", async () => {
    mocks.state.grants = [
      { id: "grant-a", accountId: "sub-a", refreshTokenExpiresAt: new Date(0) },
    ];
    mocks.listProperties.mockResolvedValue([]);
    mocks.getUserInfoEmail.mockResolvedValue(null);
    const result = await Ga4Service.listPropertiesForUserWithGrantStatus("u1");
    expect(result.accounts[0]).toMatchObject({
      requiresReconnect: false,
      propertiesUnavailable: false,
    });
  });

  it.each([
    new TypeError("fetch failed"),
    new Ga4TokenError("token unavailable", new Error("private cause")),
    new Ga4AdminApiError(429, "rate limited"),
    new Ga4AdminApiError(503, "unavailable"),
    new Ga4AdminApiError(403, "API disabled or permission denied"),
  ])(
    "keeps discovery failure %s retryable without claiming expiry",
    async (error) => {
      mocks.listProperties.mockRejectedValue(error);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result =
        await Ga4Service.listPropertiesForUserWithGrantStatus("u1");
      expect(result.accounts).toEqual([
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: false,
          propertiesUnavailable: true,
          properties: [],
        },
      ]);
      expect(mocks.dbDelete).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private cause");
    },
  );

  it("distinguishes rejected credentials from inaccessible property discovery", async () => {
    mocks.state.grants = [
      { id: "grant-a", accountId: "sub-a" },
      { id: "grant-b", accountId: "sub-b" },
    ];
    mocks.listProperties
      .mockRejectedValueOnce(new Ga4AdminApiError(401, "unauthorized"))
      .mockRejectedValueOnce(new Ga4AdminApiError(403, "forbidden"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      Ga4Service.listPropertiesForUserWithGrantStatus("u1"),
    ).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: true,
          propertiesUnavailable: false,
          properties: [],
        },
        {
          accountId: "sub-b",
          email: null,
          requiresReconnect: false,
          propertiesUnavailable: true,
          properties: [],
        },
      ],
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("ga4.property_discovery_failed", {
      errorName: "Ga4AdminApiError",
      status: 403,
    });
    consoleError.mockRestore();
  });
});
