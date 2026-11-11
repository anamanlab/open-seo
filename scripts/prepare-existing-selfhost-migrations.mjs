// Alchemy's migration ledger has required id/applied_at columns without
// Wrangler's defaults. Prepare and rehearse one SQL import against a private
// backup, recording all three columns. This script performs no remote writes.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareMigrationSql(backup, migrations) {
  const database = new DatabaseSync(":memory:");
  try {
    // D1 exports may insert child rows before their parent tables.
    database.exec("PRAGMA foreign_keys=OFF");
    database.exec(backup);
    database.exec("PRAGMA foreign_keys=ON");
    const applied = new Set(
      database
        .prepare("SELECT name FROM d1_migrations")
        .all()
        .map((row) => row.name),
    );
    const pending = migrations.filter((item) => !applied.has(item.name));
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const sql = pending
      .map(
        ({ name, sql }) =>
          `${sql.trimEnd()}\nINSERT INTO d1_migrations (id, name, applied_at) VALUES (${quote(randomUUID())}, ${quote(name)}, ${quote(new Date().toISOString())});\n`,
      )
      .join("\n");
    database.exec(sql);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("Migration rehearsal produced foreign-key violations");
    }
    return { sql, count: pending.length };
  } finally {
    database.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [backupPath, outputPath] = process.argv.slice(2);
  if (!backupPath || !outputPath)
    throw new Error(
      "Usage: node scripts/prepare-existing-selfhost-migrations.mjs <private-backup.sql> <private-output.sql>",
    );
  const dir = resolve("drizzle/sqlite");
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const result = prepareMigrationSql(
    readFileSync(backupPath, "utf8"),
    migrations,
  );
  writeFileSync(outputPath, result.sql, { mode: 0o600 });
  console.log(
    `Rehearsed ${result.count} pending migrations with the existing ledger; prepared private SQL import.`,
  );
}
