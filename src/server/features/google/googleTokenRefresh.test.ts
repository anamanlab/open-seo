import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { genericOAuth } from "better-auth/plugins";
import { GA4_OAUTH_PROVIDER_ID } from "@/shared/ga4";
import { GSC_OAUTH_PROVIDER_ID } from "@/shared/gsc";

const secret = "test-only-oauth-encryption-secret-at-least-32-characters";
const discoveryUrl =
  "https://accounts.google.com/.well-known/openid-configuration";
const tokenUrl = "https://oauth2.googleapis.com/token";
const providerIds = [GSC_OAUTH_PROVIDER_ID, GA4_OAUTH_PROVIDER_ID];

async function createRefreshFixture(providerId: string) {
  const refreshTokenExpiresAt = new Date(Date.now() + 86400_000);
  const encryptedRefreshToken = await symmetricEncrypt({
    key: secret,
    data: "selected-refresh-token",
  });
  const selectedAccount = {
    id: "selected-row",
    accountId: "selected-google-subject",
    providerId,
    userId: "selected-user",
    accessToken: await symmetricEncrypt({
      key: secret,
      data: "expired-access",
    }),
    refreshToken: encryptedRefreshToken,
    accessTokenExpiresAt: new Date(Date.now() - 60_000),
    refreshTokenExpiresAt,
    scope: "openid,email",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const db = {
    user: [],
    session: [],
    verification: [],
    account: [
      { ...selectedAccount, id: "wrong-user-row", userId: "other-user" },
      {
        ...selectedAccount,
        id: "wrong-account-row",
        accountId: "other-subject",
      },
      {
        ...selectedAccount,
        id: "wrong-provider-row",
        providerId: providerIds.find((id) => id !== providerId)!,
      },
      selectedAccount,
    ],
  } satisfies MemoryDB;
  const auth = betterAuth({
    baseURL: "http://localhost:3001",
    secret,
    database: memoryAdapter(db),
    account: { encryptOAuthTokens: true },
    logger: { disabled: true },
    plugins: [
      genericOAuth({
        config: providerIds.map((id) => ({
          providerId: id,
          clientId: "test-google-client",
          clientSecret: "test-google-secret",
          discoveryUrl,
          scopes: ["openid", "email"],
          accessType: "offline",
        })),
      }),
    ],
  });
  const getAccessToken = () =>
    auth.api.getAccessToken({
      body: {
        userId: "selected-user",
        providerId,
        accountId: "selected-google-subject",
      },
    });
  return { db, getAccessToken, encryptedRefreshToken, refreshTokenExpiresAt };
}

function mockGoogleRefresh(
  tokenResponse: Record<string, unknown>,
  status = 200,
) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === discoveryUrl) {
        return Response.json({ token_endpoint: tokenUrl });
      }
      if (url !== tokenUrl) throw new Error("Unexpected OAuth network request");
      if (
        !(init?.body instanceof URLSearchParams) &&
        typeof init?.body !== "string"
      ) {
        throw new Error("Expected a form-encoded refresh request");
      }
      const body = new URLSearchParams(init.body);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("selected-refresh-token");
      expect(body.get("client_id")).toBe("test-google-client");
      return Response.json(tokenResponse, { status });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe.each(providerIds)(
  "real Better Auth Google refresh: %s",
  (providerId) => {
    it("refreshes the selected encrypted grant, retains its refresh token and expiry, and reuses the new access token", async () => {
      const fixture = await createRefreshFixture(providerId);
      const before = structuredClone(fixture.db.account.slice(0, 3));
      const fetchMock = mockGoogleRefresh({
        access_token: "fresh-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
      await expect(fixture.getAccessToken()).resolves.toMatchObject({
        accessToken: "fresh-access-token",
      });
      const stored = fixture.db.account.find(
        (row) => row.id === "selected-row",
      )!;
      expect(stored.refreshToken).toBe(fixture.encryptedRefreshToken);
      expect(stored.refreshTokenExpiresAt).toEqual(
        fixture.refreshTokenExpiresAt,
      );
      expect(stored.accessToken).not.toBe("fresh-access-token");
      expect(
        await symmetricDecrypt({
          key: secret,
          data: String(stored.accessToken),
        }),
      ).toBe("fresh-access-token");
      expect(fixture.db.account.slice(0, 3)).toEqual(before);
      const callsAfterRefresh = fetchMock.mock.calls.length;
      await expect(fixture.getAccessToken()).resolves.toMatchObject({
        accessToken: "fresh-access-token",
      });
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterRefresh);
    });

    it("persists a rotated encrypted refresh token with Google's new refresh lifetime", async () => {
      const fixture = await createRefreshFixture(providerId);
      const startedAt = Date.now();
      mockGoogleRefresh({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        refresh_token_expires_in: 7200,
        token_type: "Bearer",
      });
      await fixture.getAccessToken();
      const stored = fixture.db.account.find(
        (row) => row.id === "selected-row",
      )!;
      expect(stored.refreshToken).not.toBe("rotated-refresh-token");
      expect(
        await symmetricDecrypt({
          key: secret,
          data: String(stored.refreshToken),
        }),
      ).toBe("rotated-refresh-token");
      const expiresAt = new Date(stored.refreshTokenExpiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(startedAt + 7200_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7200_000);
    });

    it.each(["provider", "network"])(
      "keeps %s refresh failures opaque and leaves the stored grant intact",
      async (failure) => {
        const fixture = await createRefreshFixture(providerId);
        const before = structuredClone(fixture.db.account);
        const fetchMock = mockGoogleRefresh(
          {
            error: "invalid_grant",
            error_description: "sensitive-provider-detail",
          },
          400,
        );
        if (failure === "network")
          fetchMock.mockRejectedValue(new Error("sensitive-network-detail"));
        const error = await fixture
          .getAccessToken()
          .catch((cause: unknown) => cause);
        expect(error).toMatchObject({
          body: {
            code: "FAILED_TO_GET_ACCESS_TOKEN",
            message: "Failed to get a valid access token",
          },
        });
        expect(JSON.stringify(error)).not.toContain("sensitive-");
        expect(fixture.db.account).toEqual(before);
      },
    );
  },
);
