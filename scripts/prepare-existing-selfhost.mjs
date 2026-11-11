// Prepare Wrangler's built configs using a private snapshot of an existing
// installation. Wrangler preserves unreadable Worker secrets on deployment.
// No API writes are performed here; review/dry-run both configs before deploy.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareConfigs(settings, domains, main, audit, workerName) {
  const bindings = settings.bindings;
  const binding = (name, type) => {
    const value = bindings.find(
      (item) => item.name === name && item.type === type,
    );
    if (!value) throw new Error(`Missing live ${name} (${type}) binding`);
    return value;
  };
  const vars = Object.fromEntries(
    bindings
      .filter((item) => ["plain_text", "json"].includes(item.type))
      .map((item) => [item.name, item.type === "json" ? item.json : item.text]),
  );
  if (
    vars.AUTH_MODE !== "cloudflare_access" ||
    vars.DATABASE_PROVIDER !== "d1"
  ) {
    throw new Error(
      "This upgrade path requires the existing Access/D1 installation",
    );
  }
  binding("BETTER_AUTH_SECRET", "secret_text");
  binding("GOOGLE_CLIENT_SECRET", "secret_text");
  binding("DATAFORSEO_API_KEY", "secret_text");
  const hostname = new URL(vars.BETTER_AUTH_URL).hostname;
  const domain = domains.find(
    (item) => item.service === workerName && item.hostname === hostname,
  );
  if (
    !domain ||
    !vars.TEAM_DOMAIN ||
    !vars.POLICY_AUD ||
    !vars.GOOGLE_CLIENT_ID
  ) {
    throw new Error(
      "Existing domain or authentication configuration is incomplete",
    );
  }
  const db = binding("DB", "d1");
  const kv = binding("KV", "kv_namespace");
  const r2 = binding("R2", "r2_bucket");
  const shared = {
    keep_vars: true,
    compatibility_date: settings.compatibility_date,
    compatibility_flags: [
      ...new Set([
        ...settings.compatibility_flags,
        ...(main.compatibility_flags ?? []),
      ]),
    ],
    d1_databases: [
      {
        binding: "DB",
        database_id: db.id ?? db.database_id,
        database_name: "open-seo-db-selfhost",
        migrations_dir: resolve("drizzle/sqlite"),
      },
    ],
    kv_namespaces: [{ binding: "KV", id: kv.namespace_id }],
    r2_buckets: [{ binding: "R2", bucket_name: r2.bucket_name }],
  };
  const auditName = `${workerName}-audit`;
  return {
    main: {
      ...main,
      ...shared,
      name: workerName,
      secrets: {
        required: bindings
          .filter((item) => item.type === "secret_text")
          .map((item) => item.name),
      },
      // Alchemy-created namespaces have no Wrangler migration tag. Declarative
      // exports retain SAM by class and retire only upstream-removed classes.
      migrations: [],
      exports: {
        SamChatAgent: { type: "durable-object", storage: "sqlite" },
        AuditScratchpad: { type: "durable-object", state: "deleted" },
        OnboardingChatAgent: { type: "durable-object", state: "deleted" },
      },
      vars: { ...vars, AUDIT_BROWSER_RENDERING: "true" },
      routes: [
        { pattern: hostname, custom_domain: true, zone_id: domain.zone_id },
      ],
      kv_namespaces: [
        ...shared.kv_namespaces,
        {
          binding: "OAUTH_KV",
          id: binding("OAUTH_KV", "kv_namespace").namespace_id,
        },
      ],
      workflows: main.workflows.map((item) => ({
        ...item,
        name:
          item.binding === "SITE_AUDIT_WORKFLOW"
            ? binding("SITE_AUDIT_WORKFLOW", "workflow").workflow_name
            : item.binding === "RANK_CHECK_WORKFLOW"
              ? binding("RANK_CHECK_WORKFLOW", "workflow").workflow_name
              : `${item.name}-selfhost`,
        ...(item.binding === "SITE_AUDIT_WORKFLOW"
          ? { script_name: auditName }
          : {}),
      })),
      services: [{ binding: "AUDIT_ENGINE", service: auditName }],
      ratelimits: [
        {
          name: "MCP_RATE_LIMIT",
          namespace_id: "1001",
          simple: { limit: 5000, period: 60 },
        },
        {
          name: "AUTH_RATE_LIMIT",
          namespace_id: "1002",
          simple: { limit: 20, period: 60 },
        },
        {
          name: "SAVE_KEYWORDS_RATE_LIMIT",
          namespace_id: "1003",
          simple: { limit: 60, period: 60 },
        },
      ],
    },
    audit: {
      ...audit,
      ...shared,
      name: auditName,
      workers_dev: false,
      browser: { binding: "BROWSER" },
      secrets: { required: ["DATAFORSEO_API_KEY"] },
      migrations: [],
      exports: {
        AuditScratchpad: { type: "durable-object", storage: "sqlite" },
      },
      vars: {
        POSTHOG_PUBLIC_KEY: vars.POSTHOG_PUBLIC_KEY ?? "",
        POSTHOG_HOST: vars.POSTHOG_HOST ?? "",
        AUTH_MODE: vars.AUTH_MODE,
        DATABASE_PROVIDER: vars.DATABASE_PROVIDER,
        OPENSEO_TELEMETRY_DISABLED: vars.OPENSEO_TELEMETRY_DISABLED ?? "1",
      },
      workflows: audit.workflows.map((item) => ({
        ...item,
        name: binding("SITE_AUDIT_WORKFLOW", "workflow").workflow_name,
      })),
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [settingsPath, domainsPath] = process.argv.slice(2);
  if (!settingsPath || !domainsPath)
    throw new Error(
      "Usage: node scripts/prepare-existing-selfhost.mjs <private-settings.json> <private-domains.json>",
    );
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const mainPath = resolve("dist/server/wrangler.json");
  const auditPath = resolve("dist/open_seo_audit/wrangler.json");
  const configs = prepareConfigs(
    read(settingsPath).result,
    read(domainsPath).result,
    read(mainPath),
    read(auditPath),
    "open-seo-selfhost",
  );
  for (const [key, path] of [
    ["main", mainPath],
    ["audit", auditPath],
  ]) {
    const target = resolve(dirname(path), "wrangler.existing-selfhost.json");
    writeFileSync(target, JSON.stringify(configs[key], null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      `Prepared ${key} config at ${target}; existing secrets are inherited.`,
    );
  }
}
