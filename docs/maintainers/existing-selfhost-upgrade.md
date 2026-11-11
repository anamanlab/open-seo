# Existing Cloudflare installation upgrades

The fork tracks upstream v0.1.26 plus commit `46b815be`. The original dependency
experiment stays in its separate checkout and is not part of this upgrade.

## Fork patches retained

- Preserve original Google configuration and encrypted grants across deployment.
- Prevent automatic paid-query retries and classify DataForSEO billing failures.
- Preserve Google refresh-token expiry and distinguish reconnect from permission failures.
- Reject partial or empty API consent before replacing existing Google grants.

The new Google picker and OAuth lifecycle supersede the old fork components.
The repository and plugin contain the upstream twelve shipped SEO skills.
Review instruction and CI changes explicitly before merging this upstream sync.
The existing `.greptile/` baseline remains; organization enforcement is unverified.

## Deployment

The existing installation uses Access authentication and D1. Do not use Alchemy
when the original `BETTER_AUTH_SECRET` is unavailable: it must remain an inherited
Worker secret. Wrangler's required secrets configuration explicitly inherits
existing secrets and refuses to deploy if one is missing.

1. Save current Worker settings, custom domains, active version, and code in a
   private directory outside Git. Back up D1 and OAuth KV there too.
2. Install with the frozen lockfile. Run the full CI checks, tests, report-widget
   build, and `pnpm exec vite build --mode selfhost`, with the existing auth mode
   and URL in the ignored `.env.selfhost`.
3. Rehearse pending D1 migrations on the backup and verify project and connection
   counts and foreign-key integrity. Never print records or secret values.
4. Run `node scripts/prepare-existing-selfhost.mjs <settings.json> <domains.json>`.
   It prepares ignored configs beside the built app and audit Workers. It
   preserves resource IDs, Access configuration, custom hostname, SAM namespace,
   and existing workflow names. It adds the upstream rate limits and browser binding.
5. Dry-run each generated config with `pnpm exec wrangler deploy --config <path>
--dry-run`. Keep output private because binding values appear in Wrangler logs.
6. The Alchemy ledger requires explicit `id`, `name`, and `applied_at` fields.
   Run `node scripts/prepare-existing-selfhost-migrations.mjs <private-backup.sql>
<private-pending.sql>` to rehearse and prepare the import. Confirm the live
   ledger still matches the backup, then run `pnpm exec wrangler d1 execute DB
--remote --config <prepared-main-config> --file <private-pending.sql>`.
   Do not use `wrangler d1 migrations apply` with this ledger.
   Deploy the audit Worker first, using a private secrets file containing the
   original DataForSEO key and any configured audit-only credentials. Never copy
   Google/authentication secrets to the audit Worker. Deploy the app config next.
7. Compare live resource IDs, secret inventories, hostname, auth mode, SAM namespace,
   migrations, and connection counts to the snapshot. Verify authenticated app,
   Google data, and MCP behavior through the existing Access gate.

Upstream retires the onboarding chat and moves audit scratchpads into the audit
Worker. The generated declarative exports preserve SAM and retire the two removed
classes. Complete in-flight audits before deployment. D1 and account data remain.

A code rollback does not undo database migrations or retired Durable Objects.
Keep the previous version and private data backup until verification completes.
