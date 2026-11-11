import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { prepareMigrationSql } from "./prepare-existing-selfhost-migrations.mjs";

const backup =
  "CREATE TABLE d1_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL); INSERT INTO d1_migrations VALUES ('old', '0000.sql', '2026-01-01'); CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('existing');";

test("applies only pending migrations and supplies Alchemy's required ledger fields", () => {
  const migrations = [
    { name: "0000.sql", sql: "CREATE TABLE projects (id TEXT);" },
    { name: "0001.sql", sql: "ALTER TABLE projects ADD label TEXT;" },
  ];
  const result = prepareMigrationSql(backup, migrations);
  assert.equal(result.count, 1);
  assert.doesNotMatch(result.sql, /;\s*;/);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(backup + result.sql);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM d1_migrations WHERE applied_at IS NOT NULL",
        )
        .get().count,
      2,
    );
    assert.equal(prepareMigrationSql(backup + result.sql, migrations).count, 0);
  } finally {
    db.close();
  }
});

test("refuses to produce an import when a migration fails rehearsal", () => {
  assert.throws(
    () =>
      prepareMigrationSql(backup, [
        { name: "0001.sql", sql: "ALTER TABLE missing ADD label TEXT;" },
      ]),
    /no such table/,
  );
});
