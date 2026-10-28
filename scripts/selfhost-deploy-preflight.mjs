// Fast checks before `pnpm deploy:selfhost` spends minutes on the build — a
// missing env value or Cloudflare login should fail in seconds instead.
// (Distinct from scripts/selfhost-preflight.ts, the Docker container-start
// preflight that validates the runtime environment.)
// Everything here is best-effort duplication of errors alchemy would raise
// later anyway; when in doubt (unreadable profile, API-token auth) it stays
// quiet and lets the deploy be the judge.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import chalk from "chalk";

const cmd = chalk.cyan;
const em = chalk.yellow;

const fail = (...lines) => {
  console.error(`\n${chalk.red("deploy:selfhost preflight failed:")}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
};

// The `alchemy` script needs --experimental-strip-types (Node 22.6+).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  fail(
    `Node ${em(process.versions.node)} is too old — the deploy needs Node 22.6 or newer (24 LTS recommended).`,
  );
}

const envFile = ".env.selfhost";
if (!existsSync(envFile)) {
  fail(
    `${em(envFile)} not found — create it first:`,
    "",
    `  ${cmd("cp .env.selfhost.example .env.selfhost")}`,
    "",
    `then set ${em("DATAFORSEO_API_KEY")} and ${em("ACCESS_ALLOWED_EMAILS")}.`,
  );
}
const env = {};
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
}
if (!env.DATAFORSEO_API_KEY) {
  fail(
    `${em("DATAFORSEO_API_KEY")} is not set in ${envFile} — see docs/DATAFORSEO_API_KEY.md for how to get one.`,
  );
}

// This installation already has several projects linked to the same Google
// OAuth grants. Alchemy reconciles Worker bindings on EVERY deploy and treats
// omitted optional variables as empty. Fail BEFORE building or deploying;
// otherwise a deploy from a new VPS silently invalidates every project.
const googleClientId = (env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = (env.GOOGLE_CLIENT_SECRET || "").trim();
const betterAuthSecret = (env.BETTER_AUTH_SECRET || "").trim();
const missingGoogleConfig = [
  ["GOOGLE_CLIENT_ID", googleClientId],
  ["GOOGLE_CLIENT_SECRET", googleClientSecret],
  ["BETTER_AUTH_SECRET", betterAuthSecret],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingGoogleConfig.length) {
  fail(
    "Google OAuth is already in use by production OpenSEO projects.",
    `Missing from ${envFile}: ${missingGoogleConfig.join(", ")}.`,
    "Restore the ORIGINAL values from the canonical, secure deployment configuration.",
    "Never replace BETTER_AUTH_SECRET with a new random value: it encrypts stored Google grants.",
    "Do not deploy from a new VPS with an incomplete .env.selfhost.",
  );
}
if (
  !googleClientId.endsWith(".apps.googleusercontent.com") ||
  googleClientId.length < 50
) {
  fail("GOOGLE_CLIENT_ID does not look like a valid Google OAuth web client ID.");
}
if (betterAuthSecret.length < 32) {
  fail("BETTER_AUTH_SECRET must be at least 32 characters and must match the original deployment.");
}
// When both are set, the deploy provisions no Access resources (hand-managed
// application) and needs neither ACCESS_ALLOWED_EMAILS nor the access:write
// login scope.
const managedAccess = !(env.TEAM_DOMAIN && env.POLICY_AUD);
if (managedAccess && !env.ACCESS_ALLOWED_EMAILS) {
  fail(
    `${em("ACCESS_ALLOWED_EMAILS")} is not set in ${envFile} — list who may sign in through`,
    "Cloudflare Access (comma-separated emails), or set TEAM_DOMAIN and POLICY_AUD",
    "to manage the Access application yourself.",
  );
}

// An explicit API token bypasses login profiles entirely.
if (!process.env.CLOUDFLARE_API_TOKEN) {
  const profileName = process.env.ALCHEMY_PROFILE || "default";
  let cloudflare;
  try {
    cloudflare = JSON.parse(
      readFileSync(path.join(homedir(), ".alchemy", "profiles.json"), "utf8"),
    ).profiles?.[profileName]?.Cloudflare;
  } catch {
    cloudflare = undefined;
  }
  if (!cloudflare) {
    fail(
      `No Cloudflare login found (alchemy profile "${profileName}") — run ${cmd("pnpm alchemy login")}`,
      `first (answer yes to "Customize OAuth scopes?" and enable ${em("access:write")}).`,
    );
  }
  if (
    managedAccess &&
    cloudflare.method === "oauth" &&
    Array.isArray(cloudflare.scopes) &&
    !cloudflare.scopes.includes("access:write")
  ) {
    fail(
      `Your Cloudflare login is missing the ${em("access:write")} scope, which the deploy needs`,
      "to provision the Cloudflare Access login gate. Log in again with the scope enabled:",
      "",
      `  ${cmd("pnpm alchemy login --configure")}`,
      "",
      `When asked "Customize OAuth scopes?", answer yes, then select ${em("access:write")}`,
      "(space to toggle, enter to confirm — keep the preselected defaults).",
    );
  }
}
