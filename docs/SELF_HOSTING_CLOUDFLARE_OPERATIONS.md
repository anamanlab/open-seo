# Cloudflare Self-Hosting: Operations

Day-to-day tasks after [initial setup](./SELF_HOSTING_CLOUDFLARE.md): connect the MCP server and manage telemetry. Updating and teammate access are covered in the [deploy guide](./SELF_HOSTING_CLOUDFLARE.md) (or the [legacy page](./SELF_HOSTING_CLOUDFLARE_LEGACY.md) for pre-alchemy deployments).

## Connect the MCP server through Cloudflare Access

Use the same Cloudflare Access application that protects your OpenSEO Worker.
Managed OAuth is required for MCP clients and is not enabled by default.

1. Open Cloudflare Zero Trust.
2. Go to `Access controls` -> `Applications`.
3. Find your OpenSEO application, then select `Edit`.
4. Go to `Additional settings` -> `OAuth`.
5. Turn on `Managed OAuth`.
6. In `Managed OAuth settings`, allow the redirect URIs your MCP clients use:
   - Allow `localhost` / loopback clients for CLI and desktop agents (Codex
     CLI, Claude Code) that register `http://localhost:PORT/callback`.
   - Add HTTPS redirect URIs for web connectors (a path may end in `/*`).
   - Without this, clients can't finish [Dynamic Client Registration](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
     and log in but expose no tools.
7. Save.

MCP clients should connect to:

```text
https://YOUR_WORKER_HOSTNAME/mcp
```

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` in `.env.selfhost` and redeploy. Docker and [legacy deployments](./SELF_HOSTING_CLOUDFLARE_LEGACY.md): set it (or `DO_NOT_TRACK=1`) as an environment variable / Worker variable instead.

## Keep Google integrations connected

There are separate credentials for the MCP client, the Google OAuth app, and
stored Google grants. Reconnecting an MCP client does not renew the project's
Google Analytics or Search Console authorization.

- Keep the original `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `BETTER_AUTH_SECRET` in one secure production deployment configuration.
  Git does not copy ignored `.env` files between machines. The Better Auth secret
  encrypts stored grants; replacing it is not a token-expiry fix.
- The self-host deploy preflight rejects missing credentials, but cannot prove
  that nonempty credentials match those used to encrypt existing grants. The
  manual production workflow is an available deployment path, not an enforcement
  mechanism that disables local CLI deployments. Configure its production
  environment securely and verify a successful run before treating it as adopted.
- Check the **correct OAuth client's Google Cloud project** and its Audience
  publishing status. External apps in Testing generally issue seven-day grants
  for Analytics/Search Console scopes. Review Google's production requirements
  before changing status; then obtain fresh consent if needed. Do not infer the
  latest consent date from the account row's creation date.
- Google can also issue time-limited consent or revoke access. A missing recorded
  refresh expiry means **unknown**, not permanent access. Do not edit expiry
  timestamps to work around Google's policy.
- After authorized reconnection, verify both integrations immediately and again
  after their access-token lifetime (usually about an hour). Confirm unattended
  operation beyond seven days from the new consent, or beyond any recorded
  refresh expiry, before declaring a recurring-expiry issue resolved.

A token-acquisition failure is not proof of revocation: configuration, encryption,
network, or provider errors can look alike. Better Auth may hide the underlying
provider error. Do not dump errors, token responses, OAuth codes, or secret values
into logs to investigate. Report only explicitly allowlisted diagnostic fields
when available; otherwise keep the cause unknown. Preserve project/property
mappings during recovery. Changes to Google consent, deployment configuration,
or encryption keys require the operator's approval.

References: [Google refresh-token lifecycle](https://developers.google.com/identity/protocols/oauth2#expiration)
and [web-server OAuth and time-based access](https://developers.google.com/identity/protocols/oauth2/web-server#time-based-access).
