import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required.");

const appUser = process.env.APP_DATABASE_USER ?? "handoff_app";
const appPassword = process.env.APP_DATABASE_PASSWORD ?? "handoff_app";

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appUser)) {
  throw new Error("APP_DATABASE_USER contains invalid characters.");
}

function sqlLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function sqlIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

const legacyMigrationAliases: Readonly<Record<string, string>> = {
  "0026_public_api_webhooks.sql": "0027_public_api_webhooks.sql",
  "0027_lgpd_retention.sql": "0028_lgpd_retention.sql",
  "0028_lgpd_processing_register.sql": "0029_lgpd_processing_register.sql",
  "0029_audit_anchors.sql": "0030_audit_anchors.sql",
  "0030_identity_token_scope.sql": "0031_identity_token_scope.sql",
};

const client = new Client({ connectionString: migrationUrl });
await client.connect();

try {
  const role = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
    [appUser],
  );

  if (!role.rows[0]?.exists) {
    await client.query(
      `CREATE ROLE "${appUser}" LOGIN PASSWORD ${sqlLiteral(appPassword)} NOBYPASSRLS`,
    );
  } else {
    await client.query(
      `ALTER ROLE "${appUser}" WITH LOGIN PASSWORD ${sqlLiteral(appPassword)} NOBYPASSRLS`,
    );
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
  );

  for (const [legacyFilename, currentFilename] of Object.entries(legacyMigrationAliases)) {
    const legacy = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [legacyFilename],
    );
    if (legacy.rowCount !== 1) continue;

    const current = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [currentFilename],
    );

    if (current.rowCount === 1) {
      throw new Error(
        `Migration history contains both legacy and current filenames: ${legacyFilename} / ${currentFilename}.`,
      );
    }

    process.stdout.write(
      `[migrate] normalizing legacy migration name ${legacyFilename} -> ${currentFilename}\n`,
    );
    await client.query(
      "UPDATE schema_migrations SET filename = $2 WHERE filename = $1",
      [legacyFilename, currentFilename],
    );
  }

  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  const sources = new Map<string, { sql: string; checksum: string }>();
  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    sources.set(filename, { sql, checksum: checksum(sql) });
  }

  const history = await client.query<{ filename: string; checksum: string | null }>(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
  );

  for (const applied of history.rows) {
    const source = sources.get(applied.filename);
    if (!source) {
      throw new Error(
        `Applied migration ${applied.filename} is missing from the application image.`,
      );
    }

    if (applied.checksum === null) {
      process.stdout.write(
        `[migrate] recording checksum for existing migration ${applied.filename}\n`,
      );
      await client.query(
        "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1",
        [applied.filename, source.checksum],
      );
      continue;
    }

    if (applied.checksum !== source.checksum) {
      throw new Error(
        `Migration checksum mismatch for ${applied.filename}. Applied migrations are immutable; create a new migration instead of editing an old one.`,
      );
    }
  }

  const alreadyApplied = new Set(history.rows.map((row) => row.filename));

  for (const filename of files) {
    if (alreadyApplied.has(filename)) continue;

    const source = sources.get(filename);
    if (!source) throw new Error(`Migration source missing for ${filename}.`);

    process.stdout.write(`[migrate] applying ${filename}\n`);
    await client.query(source.sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [filename, source.checksum],
    );
  }

  await client.query(
    "ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL",
  );

  const databaseResult = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  const databaseName = databaseResult.rows[0]!.name;

  await client.query(
    `GRANT CONNECT ON DATABASE ${sqlIdentifier(databaseName)} TO "${appUser}"`,
  );
  await client.query(`GRANT USAGE ON SCHEMA public TO "${appUser}"`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appUser}"`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appUser}"`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUser}"`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appUser}"`);

  process.stdout.write("[migrate] done\n");
} finally {
  await client.end();
}
