import { AppError } from "@/server/lib/errors";

export function assertGoogleApiScopes(
  integration: { displayName: string; scopes: readonly string[] },
  scope: string | undefined,
) {
  // OAuth permits omission only when granted scopes equal those requested.
  // Google canonicalizes identity scopes; check the requested API scopes.
  const grantedScopes = new Set(
    scope === undefined ? integration.scopes : scope.trim().split(/\s+/),
  );
  const missingApiScope = integration.scopes.some(
    (requested) =>
      !["openid", "email", "profile"].includes(requested) &&
      !grantedScopes.has(requested),
  );
  if (missingApiScope) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${integration.displayName} access was not granted. Reconnect with Google and allow read-only access to ${integration.displayName}. Your existing connection has not been changed.`,
    );
  }
}
