import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./selfhost-deploy-preflight.mjs", import.meta.url),
);
const dummySecret = "DUMMY_SECRET_VALUE_DO_NOT_PRINT";
const configurations = [
  ["no configuration", null],
  ["CUSTOM_DOMAIN-only configuration", "CUSTOM_DOMAIN=seo.example.com\n"],
  [
    "complete Google configuration",
    `CUSTOM_DOMAIN=seo.example.com\nAUTH_MODE=cloudflare_access\nDATAFORSEO_API_KEY=${dummySecret}\nGOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=${dummySecret}\nBETTER_AUTH_SECRET=${dummySecret}\n`,
  ],
];

for (const [name, configuration] of configurations) {
  test(`refuses legacy Alchemy deployment with ${name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "openseo-preflight-"));
    try {
      if (configuration !== null)
        writeFileSync(join(directory, ".env.selfhost"), configuration, {
          mode: 0o600,
        });
      const result = spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: "utf8",
        env: {},
      });
      assert.equal(result.status, 1);
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /deploy:selfhost is disabled/);
      assert.match(
        result.stderr,
        /docs\/maintainers\/existing-selfhost-upgrade\.md/,
      );
      assert.doesNotMatch(
        result.stdout + result.stderr,
        new RegExp(dummySecret),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
