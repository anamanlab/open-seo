# Google connection recovery — November 2, 2026

## Production diagnosis

The live `open-seo-selfhost` Worker serves `seo.optvoo.com`. Its current Google
OAuth client belongs to Google Cloud project `optvoo`. On November 2, read-only
checks confirmed that the client ID, client-secret binding, and original
encryption-secret binding were present. The required Analytics Admin, Analytics
Data, and Search Console APIs were enabled. Four GSC and four GA4 project
mappings remained intact.

Both stored grants last refreshed successfully on October 29 around 13:13 UTC.
Their access tokens expired around 14:13 UTC; their recorded refresh-grant
expiries were October 29 at 21:34:17 UTC (GSC) and 21:34:41 UTC (GA4). These
timestamps establish expired recorded grants, not the underlying Google policy.
The account row's creation time does not establish the latest consent time.

Google's [refresh-token lifecycle documentation](https://developers.google.com/identity/protocols/oauth2#expiration)
describes seven-day grants for External apps in Testing with these scopes, as
well as time-based consent and other revocation policies. Confirm the actual
project's Audience settings before attributing this incident to Testing.

## Application defects corrected

Discovery previously turned temporary or unclassified failures into the exact
“Connection expired” banner. GSC did so for every exception; GA4 did so for every
opaque token error. Discovery now separates unavailable accounts from accounts
whose authorization needs renewal. A failed token request with a known past
refresh expiry prompts renewal; unknown or future expiry remains unavailable
with Retry. Successful access remains usable even if a refresh expiry is past.
Permission failures do not imply expired consent. Project mappings are retained.

The OAuth callback preserves Google's optional refresh-token lifetime and keeps
retained tokens paired with their known expiry. Reporting and MCP errors avoid
claiming revocation from opaque token failures or property permission failures.
Discovery logs only allowlisted error names and statuses.

Tests using the locked Better Auth 1.6.22 implementation verify encrypted token
refresh, correct account selection, persistence and reuse, retention and rotation
of refresh credentials, finite lifetime updates, and opaque provider/network
failures. The evidence supports automatic access-token refresh working while the
Google grant remains valid. A refresh cron cannot extend an expired Google grant.

## Operational recovery and acceptance

1. Inspect [Audience for the correct project](https://console.cloud.google.com/auth/audience?project=optvoo).
   Complete applicable production-publishing requirements if Testing is the
   cause. Do not rotate the OAuth client or encryption key as an expiry fix.
2. Renew expired Search Console and Analytics consent using their existing
   integration controls at `https://seo.optvoo.com`. Reuse existing project
   mappings; do not delete grants or project connections to recover.
3. Check listing and reporting immediately, then after the new access-token
   lifetime. Record successful unattended refresh beyond seven days from fresh
   consent and beyond the observed failure interval. Finite grants require
   renewed consent; unknown expiry is not a guarantee of permanence.
4. Verify a code redeploy preserves the same client, encryption secret, and
   database/KV/DO/workflow bindings. Roll back code to the prior Worker version
   if runtime checks fail; never restore a stale database as a code rollback.

## Deployment continuity

The merged deployment guard rejects incomplete OAuth configuration. However,
the GitHub production workflow had no configured production environment or
repository secrets at investigation time, and the local environment file lacked
the original OAuth and encryption secrets. Those paths must not be used as if
they were a complete production configuration.

A code-only recovery release can instead upload a candidate Worker version with
Wrangler's inherited bindings and retained secrets, without reading secret
values or reconciling infrastructure. Before activating it, compare every
candidate binding against the live baseline, including resource IDs, plain-text
configuration, secret names/types, compatibility flags, and asset behavior.
This retains existing secret values in Cloudflare and avoids copying the local
development resource IDs into production. Keep the previous active version as
the rollback target. This does not configure the canonical GitHub workflow;
adopting that workflow still requires the original secure deployment values.
