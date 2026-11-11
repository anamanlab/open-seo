import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareConfigs } from "./prepare-existing-selfhost.mjs";

function fixture() {
  const vars = {
    AUTH_MODE: "cloudflare_access",
    DATABASE_PROVIDER: "d1",
    BETTER_AUTH_URL: "https://seo.example.com",
    TEAM_DOMAIN: "https://team.cloudflareaccess.com",

    GOOGLE_CLIENT_ID: "existing-client",
  };
  const settings = {
    compatibility_date: "2025-09-02",
    compatibility_flags: ["nodejs_compat"],
    bindings: [
      { name: "POLICY_AUD", type: "json", json: "audience" },
      ...Object.entries(vars).map(([name, text]) => ({
        name,
        text,
        type: "plain_text",
      })),
      ...[
        "BETTER_AUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "DATAFORSEO_API_KEY",
      ].map((name) => ({
        name,
        type: "secret_text",
      })),
      { name: "DB", type: "d1", id: "existing-db" },
      { name: "KV", type: "kv_namespace", namespace_id: "existing-kv" },
      {
        name: "OAUTH_KV",
        type: "kv_namespace",
        namespace_id: "existing-oauth",
      },
      { name: "R2", type: "r2_bucket", bucket_name: "existing-bucket" },
      {
        name: "SITE_AUDIT_WORKFLOW",
        type: "workflow",
        workflow_name: "existing-audit",
      },
      {
        name: "RANK_CHECK_WORKFLOW",
        type: "workflow",
        workflow_name: "existing-rank",
      },
    ],
  };
  const domains = [
    { service: "app", hostname: "seo.example.com", zone_id: "zone" },
  ];
  const main = {
    workflows: [
      { name: "audit", binding: "SITE_AUDIT_WORKFLOW" },
      { name: "rank", binding: "RANK_CHECK_WORKFLOW" },
    ],
  };
  return [settings, domains, main, { workflows: [{ name: "audit" }] }, "app"];
}

test("preserves existing resources and domain without supplying unreadable secrets", () => {
  const { main, audit } = prepareConfigs(...fixture());
  assert.equal(main.vars.BETTER_AUTH_SECRET, undefined);
  assert.equal(main.vars.GOOGLE_CLIENT_SECRET, undefined);
  assert.equal(main.keep_vars, true);
  assert.ok(main.secrets.required.includes("BETTER_AUTH_SECRET"));
  assert.equal(main.exports.SamChatAgent.storage, "sqlite");
  assert.equal(main.migrations.length, 0);
  assert.equal(main.d1_databases[0].database_id, "existing-db");
  assert.equal(main.kv_namespaces[1].id, "existing-oauth");
  assert.equal(main.routes[0].pattern, "seo.example.com");
  assert.equal(main.services[0].service, "app-audit");
  assert.equal(main.workflows[0].name, audit.workflows[0].name);
});

test("refuses incomplete secret inventory and detached hostname", () => {
  const missing = fixture();
  missing[0].bindings = missing[0].bindings.filter(
    (item) => item.name !== "BETTER_AUTH_SECRET",
  );
  assert.throws(() => prepareConfigs(...missing), /BETTER_AUTH_SECRET/);
  const detached = fixture();
  detached[1] = [];
  assert.throws(() => prepareConfigs(...detached), /domain/);
});
