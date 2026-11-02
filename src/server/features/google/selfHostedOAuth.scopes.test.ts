import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelfHostedGoogleAuthorizationUrl,
  GA4_INTEGRATION,
  GSC_INTEGRATION,
  handleSelfHostedGoogleOAuthCallback,
  handleSelfHostedGoogleOAuthCallbackRequest,
  type SelfHostedGoogleOAuthIntegration,
} from "./selfHostedOAuth";

const mocks = vi.hoisted(() => ({
  getGoogleOAuthClientConfig: vi.fn(),
  hasSelfHostedGoogleOAuthConfig: vi.fn(),
  fetch: vi.fn(),
  selectLimit: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  getAuth: vi.fn(),
  resolveLocalNoAuthContext: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { AUTH_MODE: "local_noauth" } }));
vi.mock("@/middleware/ensure-user/delegated", () => ({
  resolveLocalNoAuthContext: mocks.resolveLocalNoAuthContext,
}));
vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
}));
vi.mock("@/db/schema", () => ({
  account: {
    id: "id",
    userId: "userId",
    providerId: "providerId",
    accountId: "accountId",
  },
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.selectLimit }) }),
    }),
    insert: () => ({ values: mocks.insertValues }),
    update: () => ({
      set: mocks.updateSet.mockReturnValue({ where: vi.fn() }),
    }),
  },
}));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/server/features/google/oauth-config", () => ({
  getGoogleOAuthClientConfig: mocks.getGoogleOAuthClientConfig,
  hasSelfHostedGoogleOAuthConfig: mocks.hasSelfHostedGoogleOAuthConfig,
}));

const user = { userId: "user-1", userEmail: "user@example.com" };
const publicOrigin = "http://localhost:3001";
const callbackURL = `${publicOrigin}/p/project/settings`;

async function authorizationState(
  integration: SelfHostedGoogleOAuthIntegration,
) {
  const url = new URL(
    await createSelfHostedGoogleAuthorizationUrl({
      integration,
      user,
      callbackURL,
      publicOrigin,
    }),
  );
  return url.searchParams.get("state")!;
}

function callbackRequest(
  integration: SelfHostedGoogleOAuthIntegration,
  state: string,
  params: Record<string, string>,
) {
  const url = new URL(integration.callbackPath, publicOrigin);
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

describe("self-hosted Google consent scope persistence", () => {
  beforeEach(() => {
    mocks.resolveLocalNoAuthContext.mockResolvedValue(user);
    mocks.getGoogleOAuthClientConfig.mockResolvedValue({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
    mocks.hasSelfHostedGoogleOAuthConfig.mockResolvedValue(true);
    mocks.selectLimit.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.getAuth.mockReturnValue({
      $context: Promise.resolve({
        options: { account: { encryptOAuthTokens: false } },
        secretConfig: "secret",
      }),
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each([GA4_INTEGRATION, GSC_INTEGRATION])(
    "$displayName consent scopes",
    (integration) => {
      it.each([
        "",
        "openid https://www.googleapis.com/auth/drive.readonly",
        "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
      ])(
        "rejects partial consent before replacing an existing grant (%s)",
        async (scope) => {
          mocks.selectLimit.mockResolvedValue([
            {
              id: "stored-account",
              refreshToken: "existing-token",
              refreshTokenExpiresAt: null,
            },
          ]);
          const state = await authorizationState(integration);
          mocks.fetch.mockResolvedValue(
            Response.json({
              access_token: "partial-access-token",
              refresh_token: "partial-refresh-token",
              scope,
              id_token: `header.${btoa(JSON.stringify({ sub: "account-1" }))}.signature`,
            }),
          );
          await expect(
            handleSelfHostedGoogleOAuthCallback({
              integration,
              request: callbackRequest(integration, state, { code: "code" }),
              user,
              publicOrigin,
            }),
          ).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            message: `${integration.displayName} access was not granted. Reconnect with Google and allow read-only access to ${integration.displayName}. Your existing connection has not been changed.`,
          });
          expect(mocks.updateSet).not.toHaveBeenCalled();
          expect(mocks.insertValues).not.toHaveBeenCalled();
        },
      );

      it("returns actionable sanitized HTTP 400 for partial consent", async () => {
        const state = await authorizationState(integration);
        mocks.fetch.mockResolvedValue(
          Response.json({
            access_token: "sensitive-access-token",
            refresh_token: "sensitive-refresh-token",
            scope: "openid",
          }),
        );
        const response = await handleSelfHostedGoogleOAuthCallbackRequest(
          callbackRequest(integration, state, { code: "sensitive-code" }),
          integration,
        );
        expect(response.status).toBe(400);
        const message = await response.text();
        expect(message).toContain(
          `allow read-only access to ${integration.displayName}`,
        );
        expect(message).not.toContain("sensitive-");
        expect(mocks.updateSet).not.toHaveBeenCalled();
        expect(mocks.insertValues).not.toHaveBeenCalled();
      });

      it.each(["granted", "omitted"])(
        "accepts %s requested API scopes",
        async (kind) => {
          const state = await authorizationState(integration);
          const scopes = integration.scopes.filter(
            (scope) => !["openid", "email", "profile"].includes(scope),
          );
          const scope =
            kind === "granted"
              ? [
                  "openid",
                  "https://www.googleapis.com/auth/userinfo.email",
                  "https://www.googleapis.com/auth/userinfo.profile",
                  ...scopes,
                ].join(" ")
              : undefined;
          mocks.fetch.mockResolvedValue(
            Response.json({
              access_token: "access-token",
              refresh_token: "refresh-token",
              scope,
              id_token: `header.${btoa(JSON.stringify({ sub: "account-1" }))}.signature`,
            }),
          );
          const response = await handleSelfHostedGoogleOAuthCallback({
            integration,
            request: callbackRequest(integration, state, { code: "code" }),
            user,
            publicOrigin,
          });
          expect(response.status).toBe(303);
          expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
              providerId: integration.providerId,
              scope:
                kind === "granted"
                  ? scope?.split(" ").join(",")
                  : integration.scopes.join(","),
            }),
          );
        },
      );
    },
  );
});
